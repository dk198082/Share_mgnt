import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { Request, Response } from "express";
import { identityFromClaims, safeReturnTo } from "./auth";
import { employeeIdentity, employeeRole, requireEmployee, requireAdmin } from "../middlewares/employee";
import { matchingSigners } from "./approval-policy";
import { auditContext } from "./audit";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const previousEnv = { NODE_ENV: process.env.NODE_ENV, AUTH_TEST_TENANT_ID: process.env.AUTH_TEST_TENANT_ID };
before(() => { process.env.NODE_ENV = "test"; process.env.AUTH_TEST_TENANT_ID = tenantId; });
after(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const claims = (id = "101", email = "john@example.test", verified: unknown = true) => ({
  sub: id, oid: `00000000-0000-4000-8000-${id.padStart(12, "0")}`, tid: tenantId,
  email, email_verified: verified, first_name: "John", last_name: "Pilot",
});
function request(user?: ReturnType<typeof identityFromClaims>, origin?: string) {
  return {
    user, method: "POST",
    get: (header: string) => header === "origin" ? origin : header === "host" ? "pilot.example.test" : undefined,
  } as unknown as Request;
}
function response() {
  const result = { status: 200, body: null as unknown };
  const res = { set() { return res; }, status(s: number) { result.status = s; return res; }, json(body: unknown) { result.body = body; return res; } } as unknown as Response;
  return { res, result };
}
test("Entra identities use the tenant object ID and verified email, not an app role", async () => {
  const john = identityFromClaims(claims());
  const kathy = identityFromClaims({ ...claims("102", "kathy@example.test"), first_name: "Kathy" });
  assert.notEqual(john.id, kathy.id);
  assert.equal(await employeeRole(request(john)), "pilot");
  assert.equal(await employeeRole(request(kathy)), "pilot");
  assert.equal(await employeeRole(request()), null);
  assert.deepEqual(await employeeIdentity(request(john)), { id: john.id, emails: ["john@example.test"], notificationEmail: "john@example.test" });
  for (const value of [false, undefined, "true", 1]) {
    const unverified = identityFromClaims({ ...claims("103"), email_verified: value });
    assert.equal(unverified.emailVerified, false);
    assert.deepEqual((await employeeIdentity(request(unverified))).emails, []);
  }
  assert.throws(() => identityFromClaims({ email: "john@example.test" }), /object ID/);
  const signers = [{ id: "named-john", name: "John", email: "john@example.test", signaturePath: "/fixture" }];
  assert.equal(matchingSigners(signers, (await employeeIdentity(request(john))).emails).length, 1);
  assert.equal(matchingSigners(signers, (await employeeIdentity(request(kathy))).emails).length, 0);
});
test("employee first name uses the given-name claim or parses family-first display names", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    tenantId: process.env.AUTH_TEST_TENANT_ID,
  };
  const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  process.env.NODE_ENV = "test";
  process.env.AUTH_TEST_TENANT_ID = tenantId;
  const employeeClaims = (name: string, extra: Record<string, unknown> = {}) => ({
    oid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tid: tenantId, name, ...extra,
  });
  try {
    assert.equal(identityFromClaims(employeeClaims("Millane, Michael", {
      given_name: "Michael", family_name: "Millane",
    })).firstName, "Michael");
    assert.equal(identityFromClaims(employeeClaims("Millane, Michael")).firstName, "Michael");
    assert.equal(identityFromClaims(employeeClaims("Michael Millane")).firstName, "Michael");
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.tenantId === undefined) delete process.env.AUTH_TEST_TENANT_ID;
    else process.env.AUTH_TEST_TENANT_ID = previous.tenantId;
  }
});
test("private pilot still requires authenticated identity, rejects cross-origin writes, and records individuals", async () => {
  const denied = response();
  let calls = 0;
  await requireEmployee(request(), denied.res, () => { calls++; });
  assert.equal(denied.result.status, 401);
  assert.equal(calls, 0);
  const crossOrigin = response();
  await requireEmployee(request(identityFromClaims(claims()), "https://other.example.test"), crossOrigin.res, () => { calls++; });
  assert.equal(crossOrigin.result.status, 403);
  assert.equal(calls, 0);
  for (const [id, firstName] of [["101", "John"], ["102", "Kathy"]]) {
    const user = identityFromClaims({ ...claims(id, `${firstName.toLowerCase()}@example.test`), first_name: firstName });
    const ok = response();
    await requireAdmin(request(user, "https://pilot.example.test"), ok.res, () => {
      assert.deepEqual(auditContext.getStore(), { id: user.id, name: `${firstName} Pilot` });
      calls++;
    });
    assert.equal(ok.result.status, 200);
  }
  assert.equal(calls, 2);
});
test("login return paths preserve deep links without allowing external redirects", () => {
  assert.equal(safeReturnTo("/sign-off-requests/abc?view=pending"), "/sign-off-requests/abc?view=pending");
  for (const value of ["https://other.test", "//other.test", "/\\other.test", "/\r\nother", undefined, []]) {
    assert.equal(safeReturnTo(value), "/");
  }
});
