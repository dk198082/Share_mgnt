import assert from "node:assert/strict";
import test from "node:test";
import { buildUserDirectory } from "./user-directory";

const current = { id: "new-id", firstName: "Sample", lastName: "Employee", email: "sample@example.test" };

test("includes current identity without changing any account or sign-in state", () => {
  const rows = buildUserDirectory([], [], [], current);
  assert.deepEqual(rows, [{
    id: "entra:new-id", name: "Sample Employee", email: "sample@example.test",
    source: "microsoft_session", isCurrent: true, isSignoff: false,
  }]);
});

test("deduplicates sessions by immutable ID but never merges historical accounts by email", () => {
  const historical = { ...current, id: "legacy-id" };
  const rows = buildUserDirectory([historical], [current, current], [{ email: " SAMPLE@example.test " }], current);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isCurrent, true);
  assert.equal(rows[1].isCurrent, false);
  assert.equal(rows[1].source, "retained_account");
  assert.ok(rows.every(r => r.isSignoff));
});

test("does not leak extra profile properties and handles missing names/emails", () => {
  const session = { id: "other", firstName: null, lastName: null, email: null, access_token: "must-not-leak" };
  const rows = buildUserDirectory([], [session], [], current);
  const other = rows.find(r => r.id === "entra:other")!;
  assert.equal(other.name, "Name not available");
  assert.equal(other.email, null);
  assert.equal(other.isSignoff, false);
  assert.equal(JSON.stringify(rows).includes("must-not-leak"), false);
});
