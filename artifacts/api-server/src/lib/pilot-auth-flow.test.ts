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
import type { SessionData } from "./auth";

test("Microsoft Entra sign-in and active sessions enforce current Admin Console access", async () => {
  const issuer = "https://entra-auth-test.example.test";
  const tenantId = randomUUID();
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_TEST_ISSUER: process.env.AUTH_TEST_ISSUER,
    AUTH_TEST_TENANT_ID: process.env.AUTH_TEST_TENANT_ID,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    TENANT_ID: process.env.TENANT_ID,
    APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
    ADMIN_CONSOLE_URL: process.env.ADMIN_CONSOLE_URL,
    ADMIN_CONSOLE_API_KEY: process.env.ADMIN_CONSOLE_API_KEY,
  };
  process.env.NODE_ENV = "test";
  process.env.AUTH_TEST_ISSUER = issuer;
  process.env.AUTH_TEST_TENANT_ID = tenantId;
  process.env.CLIENT_ID = "fixture-client-id";
  process.env.CLIENT_SECRET = "fixture-client-secret";
  process.env.TENANT_ID = tenantId;
  process.env.APP_PUBLIC_ORIGIN = "https://pilot.example.test";
  process.env.ADMIN_CONSOLE_URL = "https://admin-console.example.test";
  process.env.ADMIN_CONSOLE_API_KEY = "fixture-admin-console-key";
  const originalFetch = globalThis.fetch;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const legacyId = `legacy-replit-${randomUUID()}`;
  const johnEmail = "john@fixture.example.test";
  const sids: string[] = [];
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, { oid: string; tid: string; email: string; name: string; nonce: string; challenge: string; audience?: string; tampered?: boolean }>();
  const refreshTokens = new Map(codes);
  const accessOverrides = new Map<string, "viewer" | "denied" | "outage" | "offline">();
  const accessChecks = new Map<string, number>();
  let onAccessCheck: (() => Promise<void>) | undefined;
  let refreshChecks = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://admin-console.example.test/api/access-check?")) {
      const access = new URL(url);
      assert.equal(access.searchParams.get("app"), "Shareholder Management");
      assert.equal(new Headers(init?.headers).get("X-API-Key"), "fixture-admin-console-key");
      const oid = access.searchParams.get("entraObjectId");
      assert.ok(oid);
      accessChecks.set(oid, (accessChecks.get(oid) ?? 0) + 1);
      await onAccessCheck?.();
      const override = accessOverrides.get(oid);
      if (override === "outage") return new Response(null, { status: 503 });
      if (override === "offline") throw new Error("Synthetic network failure");
      if (oid === ids[2] || override === "denied") return json({ allowed: false, reason: "Not assigned", roles: [] });
      return json({
        allowed: true, reason: null,
        roles: [oid === ids[0] && !override ? "Shareholder Management - Read / Write" : "Shareholder Management - Read Only"],
      });
    }
    if (url === `${issuer}/.well-known/openid-configuration`) return json({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/logout`,
      response_types_supported: ["code"], subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
    if (url === `${issuer}/jwks`) return json({ keys: [jwk] });
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(init?.body));
      const refresh = body.get("grant_type") === "refresh_token";
      const code = body.get("code") ?? "";
      const fixture = refresh ? refreshTokens.get(body.get("refresh_token") ?? "") : codes.get(code);
      assert.ok(fixture, "uses a valid refresh token or single-use authorization code");
      if (refresh) {
        refreshChecks++;
      } else {
        codes.delete(code);
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), fixture.challenge);
      }
      const now = Math.floor(Date.now() / 1000);
      const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({
        iss: issuer, aud: fixture.audience ?? process.env.CLIENT_ID, sub: `subject-${fixture.oid}`,
        oid: fixture.oid, tid: fixture.tid, email: fixture.email, preferred_username: fixture.email,
        email_verified: true, name: fixture.name, nonce: refresh ? undefined : fixture.nonce, iat: now, exp: now + 300,
      })).toString("base64url");
      const content = `${head}.${payload}`;
      const signature = (fixture.tampered ? Buffer.alloc(256, 0) : sign("RSA-SHA256", Buffer.from(content), privateKey)).toString("base64url");
      const refreshToken = randomUUID();
      refreshTokens.set(refreshToken, fixture);
      return json({
        access_token: "synthetic-oidc-access-token", refresh_token: refreshToken,
        token_type: "Bearer", expires_in: 300, id_token: `${content}.${signature}`,
      });
    }
    throw new Error("Unexpected network request in isolated auth test");
  };
  try {
    await db.insert(usersTable).values({
      id: legacyId, email: johnEmail, emailVerified: true, firstName: "John", lastName: "Legacy",
    });
    // Dynamic imports ensure this test's issuer is confined to its own test process.
    const auth = await import("./auth");
    const { authMiddleware, ACCESS_RECHECK_INTERVAL_MS } = await import("../middlewares/authMiddleware");
    const { requireEmployee, employeeIdentity, requireEditorForWrites } = await import("../middlewares/employee");
    const { default: authRouter } = await import("../routes/auth");
    const app = express();
    app.use(cookieParser(), express.json(), authMiddleware);
    app.use("/api", requireEditorForWrites);
    app.use((req, _res, next) => {
      req.log = logger;
      next();
    });
    app.use("/api", authRouter);
    app.get("/api/private", requireEmployee, (req, res) => {
      res.json({ id: req.user!.id, actor: auditContext.getStore() });
    });
    app.get("/api/read-probe", requireEmployee, (_req, res) => res.sendStatus(204));
    app.post("/api/write-probe", (_req, res) => res.sendStatus(204));
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
      assert.equal(current.body.user.role, index === 0 ? "editor" : "viewer");
      const history = await request(app).get("/api/private").set("Cookie", cookie).expect(200);
      assert.deepEqual(history.body.actor, { id: ids[index], name: `${name} Fixture` });
      return cookie;
    };
    const john = await login(0, "John");
    const kathy = await login(1, "Kathy");
    await request(app).post("/api/write-probe").set("Cookie", john).expect(204);
    await request(app).post("/api/write-probe").set("Cookie", kathy).expect(403);
    await request(app).get("/api/read-probe").set("Cookie", kathy).expect(204);
    for (const alteration of [{ audience: "another-application" }, { tampered: true }]) {
      const start = await request(app).get("/api/login").set("Host", "pilot.example.test").expect(302);
      const authorization = new URL(start.headers.location), code = randomUUID();
      codes.set(code, {
        oid: ids[0], tid: tenantId, email: johnEmail, name: "Synthetic Forgery", ...alteration,
        nonce: authorization.searchParams.get("nonce")!, challenge: authorization.searchParams.get("code_challenge")!,
      });
      await request(app).get(`/api/auth/callback?${new URLSearchParams({
        code, state: authorization.searchParams.get("state")!, iss: issuer,
      })}`).set("Host", "pilot.example.test").set("Cookie", cookiesOf(start)).expect(302).expect("Location", "/sign-in?error=failed");
    }
    const legacyRows = await db.select().from(usersTable).where(eq(usersTable.id, legacyId));
    assert.equal(legacyRows.length, 1, "matching email does not merge or overwrite the legacy identity");
    assert.equal(legacyRows[0].lastName, "Legacy");
    await request(app).post("/api/signoff-check").set("Cookie", john).send({}).expect(200);
    await request(app).post("/api/signoff-check").set("Cookie", kathy)
      .send({ actor: ids[0], email: "john@fixture.example.test" }).expect(403);
    const deniedStart = await request(app).get("/api/login").set("Host", "pilot.example.test").expect(302);
    const deniedAuthorization = new URL(deniedStart.headers.location);
    const deniedCode = randomUUID();
    codes.set(deniedCode, {
      oid: ids[2], tid: tenantId, email: "unassigned@fixture.example.test", name: "Unassigned User",
      nonce: deniedAuthorization.searchParams.get("nonce")!,
      challenge: deniedAuthorization.searchParams.get("code_challenge")!,
    });
    await request(app).get(`/api/auth/callback?${new URLSearchParams({
      code: deniedCode, state: deniedAuthorization.searchParams.get("state")!, iss: issuer,
    })}`).set("Host", "pilot.example.test").set("Cookie", cookiesOf(deniedStart))
      .expect(302).expect("Location", "/sign-in?error=access-denied");
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

    const sidOf = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);
    const setTiming = async (cookie: string, timing: Pick<SessionData, "access_checked_at" | "expires_at">) => {
      const sid = sidOf(cookie);
      const snapshot = await auth.getSessionSnapshot(sid);
      assert.ok(snapshot);
      await db.update(sessionsTable).set({ sess: { ...snapshot.stored as object, ...timing } })
        .where(eq(sessionsTable.sid, sid));
    };
    const stale = () => Date.now() - ACCESS_RECHECK_INTERVAL_MS;
    const active = await login(0, "John");
    const checks = accessChecks.get(ids[0])!;
    accessOverrides.set(ids[0], "viewer");
    await request(app).post("/api/write-probe").set("Cookie", active).expect(204);
    assert.equal(accessChecks.get(ids[0]), checks, "the sign-in result is reused inside the window");
    const before = (await auth.getSession(sidOf(active)))!;
    await setTiming(active, { access_checked_at: stale() });
    await Promise.all([
      request(app).post("/api/write-probe").set("Cookie", active).expect(403),
      request(app).get("/api/read-probe").set("Cookie", active).expect(204),
    ]);
    await request(app).get("/api/auth/user").set("Cookie", active).expect(200)
      .expect(({ body }) => assert.equal(body.user.role, "viewer"));
    const downgraded = (await auth.getSession(sidOf(active)))!;
    assert.equal(downgraded.user.role, "viewer");
    assert.equal(downgraded.expires_at, before.expires_at, "a role recheck is not an Entra token refresh");
    assert.equal(accessChecks.get(ids[0]), checks + 1);

    accessOverrides.set(ids[0], "denied");
    await setTiming(active, { access_checked_at: stale() });
    const revoked = await request(app).get("/api/read-probe").set("Cookie", active).expect(401);
    assert.match(cookiesOf(revoked), /^entra_sid=$/);
    assert.equal(await auth.getSession(sidOf(active)), null);
    accessOverrides.delete(ids[0]);
    await request(app).get("/api/read-probe").set("Cookie", active).expect(401);

    for (const failure of ["outage", "offline"] as const) {
      const editor = await login(0, "John");
      accessOverrides.set(ids[0], failure);
      await setTiming(editor, { access_checked_at: undefined }); // Older sessions must check immediately.
      await request(app).post("/api/write-probe").set("Cookie", editor).expect(401);
      accessOverrides.delete(ids[0]);
      await request(app).get("/api/read-probe").set("Cookie", editor).expect(401);
    }
    assert.equal(refreshChecks, 0);

    const expired = await login(0, "John");
    const beforeRefresh = accessChecks.get(ids[0])!;
    await setTiming(expired, { expires_at: Math.floor(Date.now() / 1_000) - 1 });
    accessOverrides.set(ids[0], "viewer");
    await request(app).post("/api/write-probe").set("Cookie", expired).expect(403);
    await request(app).get("/api/read-probe").set("Cookie", expired).expect(204);
    assert.equal(refreshChecks, 1, "Entra token expiry still triggers a refresh");
    assert.equal(accessChecks.get(ids[0]), beforeRefresh + 1, "refresh does exactly one access check even inside the window");
    accessOverrides.delete(ids[0]);

    const deletedDuringCheck = await login(0, "John");
    await setTiming(deletedDuringCheck, { access_checked_at: stale() });
    onAccessCheck = () => auth.deleteSession(sidOf(deletedDuringCheck));
    await request(app).post("/api/write-probe").set("Cookie", deletedDuringCheck).expect(401);
    assert.equal(await auth.getSession(sidOf(deletedDuringCheck)), null);
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
