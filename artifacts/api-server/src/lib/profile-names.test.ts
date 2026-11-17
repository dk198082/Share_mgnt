import assert from "node:assert/strict";
import test from "node:test";
import { profileNames, sessionProfileNames } from "./profile-names";

test("parses surname-first Microsoft display names without repeating the first name", () => {
  assert.deepEqual(profileNames({ name: "Example, Alex", given_name: "Alex" }), { firstName: "Alex", lastName: "Example" });
  assert.deepEqual(profileNames({ name: "Example, Alex" }), { firstName: "Alex", lastName: "Example" });
});

test("preserves normal order and multiword surnames", () => {
  assert.deepEqual(profileNames({ name: "Alex van Example" }), { firstName: "Alex", lastName: "van Example" });
  assert.deepEqual(profileNames({ name: "van Example, Alex Morgan" }), { firstName: "Alex", lastName: "van Example" });
});

test("prefers explicit first and last names over display-name formatting", () => {
  assert.deepEqual(profileNames({ name: "Different Display", given_name: " Alex Morgan ", family_name: " Example " }), { firstName: "Alex", lastName: "Example" });
  assert.deepEqual(profileNames({ name: "Other, Display", first_name: "Alex", last_name: "Example" }), { firstName: "Alex", lastName: "Example" });
});

test("handles missing or empty name fields without inventing a surname", () => {
  assert.deepEqual(profileNames({}), { firstName: null, lastName: null });
  assert.deepEqual(profileNames({ name: "Alex" }), { firstName: "Alex", lastName: null });
  assert.deepEqual(profileNames({ name: " Example, Alex ", given_name: " ", family_name: "" }), { firstName: "Alex", lastName: "Example" });
});

const oldUser = { id: "synthetic-employee", firstName: "Alex", lastName: "Alex" };
const tenant = "synthetic-tenant";
const storedToken = (claims: Record<string, unknown>) =>
  `stored-header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.stored-signature`;

test("repairs an existing session's cached duplicate name without requiring another login", () => {
  assert.deepEqual(sessionProfileNames(oldUser, storedToken({
    oid: oldUser.id, tid: tenant, name: "Example, Alex", given_name: "Alex",
  }), tenant), { firstName: "Alex", lastName: "Example" });
  assert.deepEqual(oldUser, { id: "synthetic-employee", firstName: "Alex", lastName: "Alex" });
});

test("does not use another identity's or tenant's display metadata", () => {
  const unchanged = { firstName: "Alex", lastName: "Alex" };
  for (const claims of [
    { oid: "different-employee", tid: tenant, name: "Other, Person" },
    { oid: oldUser.id, tid: "different-tenant", name: "Other, Person" },
  ]) assert.deepEqual(sessionProfileNames(oldUser, storedToken(claims), tenant), unchanged);
});

test("preserves cached names if stored display metadata is absent or malformed", () => {
  const unchanged = { firstName: "Alex", lastName: "Alex" };
  for (const token of [undefined, "", "malformed", "a.invalid.c", storedToken({ oid: oldUser.id, tid: tenant })]) {
    assert.deepEqual(sessionProfileNames(oldUser, token, tenant), unchanged);
  }
});
