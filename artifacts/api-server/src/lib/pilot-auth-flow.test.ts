import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { db, pool, sessionsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { auditContext } from "./audit";
import { matchingSigners } from "./approval-policy";
import { logger } from "./logger";

test("Microsoft Entra OIDC callbacks preserve tenant identities, private sessions, deep links and signer restrictions", async () => {
  const issuer = "https://entra-auth-test.example.test";
  const tenantId = randomUUID();
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_TEST_ISSUER: process.env.AUTH_TEST_ISSUER,
    AUTH_TEST_TENANT_ID: process.env.AUTH_TEST_TENANT_ID,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    TENANT_ID: process.env.TENANT_ID,
  };
  process.env.NODE_ENV = "test";
  process.env.AUTH_TEST_ISSUER = issuer;
  process.env.AUTH_TEST_TENANT_ID = tenantId;
  process.env.CLIENT_ID = "fixture-client-id";
  process.env.CLIENT_SECRET = "fixture-client-secret";
  process.env.TENANT_ID = tenantId;
  const originalFetch = globalThis.fetch;
  const ids = [randomUUID(), randomUUID()];
  const legacyId = `legacy-replit-${randomUUID()}`;
  const johnEmail = "john@fixture.example.test";
  const sids: string[] = [];
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, { oid: string; tid: string; email: string; name: string; nonce: string; challenge: string }>();
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${issuer}/.well-known/openid-configuration`) return json({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/logout`,
      response_types_supported: ["code"], subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
    if (url === `${issuer}/jwks`) return json({ keys: [jwk] });
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(init?.body));
      const code = body.get("code")!;
      const fixture = codes.get(code);
      assert.ok(fixture, "authorization code is valid and single-use");
      codes.delete(code);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), fixture.challenge);
      const now = Math.floor(Date.now() / 1000);
      const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({
        iss: issuer, aud: process.env.CLIENT_ID, sub: `subject-${fixture.oid}`,
        oid: fixture.oid, tid: fixture.tid, email: fixture.email, preferred_username: fixture.email,
        email_verified: true, name: fixture.name, nonce: fixture.nonce, iat: now, exp: now + 300,
      })).toString("base64url");
      const content = `${head}.${payload}`;
      const signature = sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url");
      return json({ access_token: "synthetic-oidc-access-token", token_type: "Bearer", expires_in: 300, id_token: `${content}.${signature}` });
    }
    throw new Error("Unexpected network request in isolated auth test");
  };
  try {
    await db.insert(usersTable).values({
      id: legacyId, email: johnEmail, emailVerified: true, firstName: "John", lastName: "Legacy",
    });
    // Dynamic imports ensure this test's issuer is confined to its own test process.
    const auth = await import("./auth");
    const { authMiddleware } = await import("../middlewares/authMiddleware");
    const { requireEmployee, employeeIdentity } = await import("../middlewares/employee");
    const { default: authRouter } = await import("../routes/auth");
    const app = express();
    app.use(cookieParser(), express.json(), authMiddleware);
    app.use((req, _res, next) => {
      req.log = logger;
      next();
    });
    app.use("/api", authRouter);
    app.get("/api/private", requireEmployee, (req, res) => {
      res.json({ id: req.user!.id, actor: auditContext.getStore() });
    });
    app.post("/api/signoff-check", requireEmployee, async (req, res) => {
      const identity = await employeeIdentity(req);
      const own = matchingSigners([{ id: "john-signer", name: "John", email: "john@fixture.example.test", signaturePath: "/test" }], identity.emails);
      res.status(own.length ? 200 : 403).json({ actor: identity.id });
    });
    await request(app).get("/api/private").expect(401);
    await request(app).get("/api/private").set("x-replit-user-id", ids[0]).set("x-replit-user-email", "john@fixture.example.test").expect(401);
    await request(app).get("/api/auth/user").expect(200, { user: null });
    const cookiesOf = (res: { headers: Record<string, unknown> }) => {
      const values = res.headers["set-cookie"] as string[] | undefined;
      return (values ?? []).map(c => c.split(";")[0]).join("; ");
    };
    const login = async (index: number, name: string) => {
      const start = await request(app).get("/api/login?returnTo=%2Fsign-off-requests%2Ffixture").set("Host", "pilot.example.test").expect(302);
      const authorization = new URL(start.headers.location);
      assert.equal(authorization.origin, issuer);
      assert.equal(authorization.searchParams.get("redirect_uri"), "https://pilot.example.test/api/auth/callback");
      assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      assert.match(authorization.searchParams.get("scope") ?? "", /\bopenid\b/);
      const code = randomUUID();
      codes.set(code, {
        oid: ids[index], tid: tenantId, email: index === 0 ? johnEmail : `${name.toLowerCase()}@fixture.example.test`, name: `${name} Fixture`,
        nonce: authorization.searchParams.get("nonce")!, challenge: authorization.searchParams.get("code_challenge")!,
      });
      const callback = `/api/auth/callback?${new URLSearchParams({ code, state: authorization.searchParams.get("state")!, iss: issuer })}`;
      const result = await request(app).get(callback).set("Host", "pilot.example.test").set("Cookie", cookiesOf(start)).expect(302);
      assert.equal(result.headers.location, "/sign-off-requests/fixture");
      const sessionCookie = (result.headers["set-cookie"] as unknown as string[]).find(c => c.startsWith(`${auth.SESSION_COOKIE}=`));
      assert.ok(sessionCookie);
      assert.match(sessionCookie, /HttpOnly/);
      assert.match(sessionCookie, /Secure/);
      assert.match(sessionCookie, /SameSite=Lax/);
      const cookie = sessionCookie.split(";")[0];
      sids.push(cookie.slice(cookie.indexOf("=") + 1));
      const current = await request(app).get("/api/auth/user").set("Cookie", cookie).expect(200);
      assert.equal(current.body.user.id, ids[index]);
      assert.equal(current.body.user.emailVerified, true);
      const history = await request(app).get("/api/private").set("Cookie", cookie).expect(200);
      assert.deepEqual(history.body.actor, { id: ids[index], name: `${name} Fixture` });
      return cookie;
    };
    const john = await login(0, "John");
    const kathy = await login(1, "Kathy");
    const legacyRows = await db.select().from(usersTable).where(eq(usersTable.id, legacyId));
    assert.equal(legacyRows.length, 1, "matching email does not merge or overwrite the legacy identity");
    assert.equal(legacyRows[0].lastName, "Legacy");
    await request(app).post("/api/signoff-check").set("Cookie", john).send({}).expect(200);
    await request(app).post("/api/signoff-check").set("Cookie", kathy)
      .send({ actor: ids[0], email: "john@fixture.example.test" }).expect(403);
    const wrongTenantStart = await request(app).get("/api/login").set("Host", "pilot.example.test").expect(302);
    const wrongTenantAuthorization = new URL(wrongTenantStart.headers.location);
    const wrongTenantCode = randomUUID();
    const rejectedOid = randomUUID();
    codes.set(wrongTenantCode, {
      oid: rejectedOid, tid: randomUUID(), email: "outsider@fixture.example.test", name: "Wrong Tenant",
      nonce: wrongTenantAuthorization.searchParams.get("nonce")!,
      challenge: wrongTenantAuthorization.searchParams.get("code_challenge")!,
    });
    await request(app).get(`/api/auth/callback?${new URLSearchParams({
      code: wrongTenantCode,
      state: wrongTenantAuthorization.searchParams.get("state")!,
      iss: issuer,
    })}`).set("Host", "pilot.example.test").set("Cookie", cookiesOf(wrongTenantStart))
      .expect(302).expect("Location", "/sign-in?error=failed");
    assert.equal(await request(app).get("/api/auth/user").expect(200).then(response => response.body.user), null);
    await request(app).get("/api/auth/callback?code=forged&state=forged").set("Host", "pilot.example.test").expect(302);
    await request(app).get("/api/logout").set("Host", "pilot.example.test").set("Cookie", john).expect(302);
    await request(app).get("/api/private").set("Cookie", john).expect(401);
    await db.update(sessionsTable).set({ expire: new Date(0) }).where(eq(sessionsTable.sid, sids[1]));
    await request(app).get("/api/private").set("Cookie", kathy).expect(401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (sids.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sids));
    await db.delete(usersTable).where(eq(usersTable.id, legacyId));
    await pool.end();
  }
});
