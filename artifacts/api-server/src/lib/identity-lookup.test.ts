import test from "node:test";
import assert from "node:assert/strict";
import { loadEmployeeUser, IdentityLookupError, selectVerifiedNotificationEmail } from "./identity-lookup";
const noWait = async () => {};
test("a transient identity read is retried once without replaying an approval", async () => {
  let calls = 0;
  const user = await loadEmployeeUser("person", async () => {
    if (++calls === 1) throw { status: 429 };
    return { id: "person", role: "admin" };
  }, noWait);
  assert.equal(calls, 2);
  assert.equal(user.id, "person");
});
test("identity failures remain closed and report service unavailability, not an approval failure", async () => {
  let calls = 0;
  await assert.rejects(loadEmployeeUser("person", async () => { calls++; throw { status: 503 }; }, noWait),
    e => e instanceof IdentityLookupError && e.status === 503 && e.upstreamStatus === 503);
  assert.equal(calls, 2);
});
test("deleted identities are never retried or allowed", async () => {
  let calls = 0;
  await assert.rejects(loadEmployeeUser("removed", async () => { calls++; throw { status: 404 }; }, noWait),
    e => e instanceof IdentityLookupError && e.status === 401);
  assert.equal(calls, 1);
});
test("identity results are not cached across requests, preserving revocation", async () => {
  let active = true;
  const fetch = async () => ({ role: active ? "admin" : null });
  assert.equal((await loadEmployeeUser("person", fetch, noWait)).role, "admin");
  active = false;
  assert.equal((await loadEmployeeUser("person", fetch, noWait)).role, null);
});
test("requester notification uses the primary verified email, then another verified address", () => {
  const emails = [
    { id: "primary-unverified", emailAddress: "unverified@example.test", verification: { status: "unverified" } },
    { id: "verified", emailAddress: "verified@example.test", verification: { status: "verified" } },
    { id: "primary-verified", emailAddress: "primary@example.test", verification: { status: "verified" } },
  ];
  assert.equal(selectVerifiedNotificationEmail({ emailAddresses: emails, primaryEmailAddressId: "primary-verified" }), "primary@example.test");
  assert.equal(selectVerifiedNotificationEmail({ emailAddresses: emails, primaryEmailAddressId: "primary-unverified" }), "verified@example.test");
  assert.equal(selectVerifiedNotificationEmail({ emailAddresses: [], primaryEmailAddressId: null }), null);
});
