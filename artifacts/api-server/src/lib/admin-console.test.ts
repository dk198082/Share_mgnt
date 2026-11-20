import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AdminConsoleAccessError, checkAdminConsoleAccess } from "./admin-console";

const original = {
  url: process.env.ADMIN_CONSOLE_URL,
  key: process.env.ADMIN_CONSOLE_API_KEY,
  nodeEnv: process.env.NODE_ENV,
};
afterEach(() => {
  if (original.url === undefined) delete process.env.ADMIN_CONSOLE_URL;
  else process.env.ADMIN_CONSOLE_URL = original.url;
  if (original.key === undefined) delete process.env.ADMIN_CONSOLE_API_KEY;
  else process.env.ADMIN_CONSOLE_API_KEY = original.key;
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original.nodeEnv;
});

function configure() {
  process.env.ADMIN_CONSOLE_URL = "https://admin.example.test";
  process.env.ADMIN_CONSOLE_API_KEY = "test-only-key";
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("maps the configured Read / Write entitlement to editor", async () => {
  configure();
  let requested: URL | undefined;
  let sentKey = "";
  const role = await checkAdminConsoleAccess("00000000-0000-4000-8000-000000000001", async (input, init) => {
    requested = new URL(String(input));
    sentKey = new Headers(init?.headers).get("X-API-Key") ?? "";
    return json({ allowed: true, reason: null, roles: ["Shareholder Management - Read / Write"] });
  });
  assert.equal(role, "editor");
  assert.equal(requested?.pathname, "/api/access-check");
  assert.equal(requested?.searchParams.get("entraObjectId"), "00000000-0000-4000-8000-000000000001");
  assert.equal(requested?.searchParams.get("app"), "Shareholder Management");
  assert.equal(sentKey, "test-only-key");
});

test("maps Read Only to viewer", async () => {
  configure();
  const role = await checkAdminConsoleAccess("00000000-0000-4000-8000-000000000001", async () =>
    json({ allowed: true, reason: null, roles: ["Shareholder Management - Read Only"] }));
  assert.equal(role, "viewer");
});

test("denies users without app access or a recognized role", async () => {
  configure();
  for (const body of [
    { allowed: false, reason: "Not assigned", roles: [] },
    { allowed: true, reason: null, roles: [] },
    { allowed: true, reason: null, roles: ["Unrecognized role"] },
    { allowed: true, reason: null, roles: ["Other Application - Read / Write"] },
    { allowed: true, reason: null, roles: ["Not Read / Write"] },
  ]) {
    await assert.rejects(
      checkAdminConsoleAccess("00000000-0000-4000-8000-000000000001", async () => json(body)),
      error => error instanceof AdminConsoleAccessError && error.kind === "denied",
    );
  }
});

test("fails closed when configuration, transport, or response is invalid", async () => {
  delete process.env.ADMIN_CONSOLE_URL;
  delete process.env.ADMIN_CONSOLE_API_KEY;
  await assert.rejects(checkAdminConsoleAccess("id"), error =>
    error instanceof AdminConsoleAccessError && error.kind === "unavailable");

  configure();
  await assert.rejects(checkAdminConsoleAccess("id", async () => json({ nope: true })), error =>
    error instanceof AdminConsoleAccessError && error.kind === "unavailable");
  await assert.rejects(checkAdminConsoleAccess("id", async () => { throw new Error("network"); }), error =>
    error instanceof AdminConsoleAccessError && error.kind === "unavailable");
});
