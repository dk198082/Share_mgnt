import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { identityFromClaims, safeReturnTo } from "./auth";
import { employeeIdentity, employeeRole, requireEmployee, requireAdmin } from "../middlewares/employee";
import { matchingSigners } from "./approval-policy";
import { auditContext } from "./audit";

const claims = (id = "101", email = "john@example.test", verified: unknown = true) => ({
  sub: id, email, email_verified: verified, first_name: "John", last_name: "Pilot",
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
test("pilot identities use the signed subject and strictly verified email, never an app role", async () => {
  const john = identityFromClaims(claims());
  const kathy = identityFromClaims({ ...claims("102", "kathy@example.test"), first_name: "Kathy" });
  assert.notEqual(john.id, kathy.id);
  assert.equal(await employeeRole(request(john)), "pilot");
  assert.equal(await employeeRole(request(kathy)), "pilot");
  assert.equal(await employeeRole(request()), null);
  assert.deepEqual(await employeeIdentity(request(john)), { id: "101", emails: ["john@example.test"], notificationEmail: "john@example.test" });
  for (const value of [false, undefined, "true", 1]) {
    const unverified = identityFromClaims({ ...claims("103"), email_verified: value });
    assert.equal(unverified.emailVerified, false);
    assert.deepEqual((await employeeIdentity(request(unverified))).emails, []);
  }
  assert.throws(() => identityFromClaims({ email: "john@example.test" }), /subject/);
  const signers = [{ id: "named-john", name: "John", email: "john@example.test", signaturePath: "/fixture" }];
  assert.equal(matchingSigners(signers, (await employeeIdentity(request(john))).emails).length, 1);
  assert.equal(matchingSigners(signers, (await employeeIdentity(request(kathy))).emails).length, 0);
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
      assert.deepEqual(auditContext.getStore(), { id, name: `${firstName} Pilot` });
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
