import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

export const identities = {
  viewer: { id: "bef63c2a-afdc-4fb5-8837-1a4e255de5cf", email: "viewer@example.test", name: "Viewer Fixture" },
  editor: { id: "dd35cff0-9a9c-4c21-a118-a78ee05af44e", email: "editor@example.test", name: "Editor Fixture" },
};
export const tenant = "e4392af4-636f-4f19-8c8a-e4e5d78ea2a8";
export const clientId = "browser-fixture-client";
export const clientSecret = "browser-fixture-secret";
export const consoleKey = "browser-fixture-console-key";

export function oidcFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "fixture-key";
  const keys = [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }];
  const codes = new Map();
  const accessChecks = new Set();
  let nextAccount;
  const json = (res, body) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    accessChecks,
    selectAccount(role) {
      assert.ok(Object.hasOwn(identities, role));
      assert.equal(nextAccount, undefined, "consume the previous fixture account before selecting another");
      nextAccount = role;
    },
    async handle(req, res, url) {
      const issuer = `${url.origin}/oidc`;
      if (url.pathname === "/oidc/.well-known/openid-configuration") {
        return json(res, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"] });
      }
      if (url.pathname === "/oidc/jwks") return json(res, { keys });
      if (url.pathname === "/oidc/authorize") {
        const query = url.searchParams;
        assert.equal(query.get("client_id"), clientId);
        assert.equal(query.get("code_challenge_method"), "S256");
        assert.equal(query.get("response_type"), "code");
        const callback = new URL(query.get("redirect_uri"));
        assert.equal(callback.href, `${url.origin}/api/auth/callback`);
        const state = query.get("state"), nonce = query.get("nonce"), challenge = query.get("code_challenge");
        assert.ok(state && nonce && challenge);
        // The fixture chooses which fictional user authenticated at the IdP. The app
        // still verifies the state, one-time code, PKCE, nonce, signed token and tenant.
        const role = nextAccount;
        assert.ok(role, "fixture account must be selected before browser sign-in");
        nextAccount = undefined;
        const code = randomUUID();
        codes.set(code, { identity: identities[role], nonce, challenge });
        callback.search = new URLSearchParams({ code, state, iss: issuer });
        return res.writeHead(302, { Location: callback.href }).end();
      }
      if (url.pathname === "/oidc/token") {
        assert.equal(req.method, "POST");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        assert.equal(body.get("client_id"), clientId);
        assert.equal(body.get("client_secret"), clientSecret);
        const code = body.get("code"), issued = codes.get(code);
        assert.ok(issued, "expected an unused synthetic authorization code");
        codes.delete(code);
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("redirect_uri"), `${url.origin}/api/auth/callback`);
        assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), issued.challenge);
        const { identity, nonce } = issued;
        const now = Math.floor(Date.now() / 1000);
        const content = `${b64({ alg: "RS256", kid })}.${b64({ iss: issuer, aud: clientId, sub: identity.id,
          oid: identity.id, tid: tenant, email: identity.email, preferred_username: identity.email,
          email_verified: true, name: identity.name, nonce, iat: now, exp: now + 600 })}`;
        return json(res, { access_token: "fictional-access-token", token_type: "Bearer", expires_in: 600,
          id_token: `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}` });
      }
      if (url.pathname === "/api/access-check") {
        assert.equal(req.headers["x-api-key"], consoleKey);
        assert.equal(url.searchParams.get("app"), "Shareholder Management");
        const role = Object.keys(identities).find(role => identities[role].id === url.searchParams.get("entraObjectId"));
        assert.ok(role, "only fictional Entra identities can reach the console fixture");
        accessChecks.add(role);
        return json(res, { allowed: true, reason: null,
          roles: [`Shareholder Management - ${role === "viewer" ? "Read Only" : "Read / Write"}`] });
      }
      res.writeHead(404).end();
    },
  };
}
