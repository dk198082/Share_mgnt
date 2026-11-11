import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, pool, shareholdersTable, activityTable } from "@workspace/db";
import { auditContext, change, profileChanges, recordActivity } from "./audit";
import { loadHistoryPage } from "./history";
import { CertificateError, type Transaction } from "./certificates";
import { encryptSsn, matchesEncryptedSsn } from "./ssn";

test("profile audit covers fields and redacts sensitive/storage values", () => {
  const before = { name: "Before", email: "old@example.com", dateOfBirth: "1980-01-01", dateOfPassing: "",
    address: "Old", phone: "111", familyLine: "Line A", generationNumber: "1", financialNotes: "Old\nnotes",
    picturePath: "/objects/private-old", documents: [{ name: "old.pdf", objectPath: "/objects/private-doc-old", size: 10 }] };
  const after = { name: "After", email: "", dateOfBirth: "1981-01-01", dateOfPassing: "2025-01-01",
    address: "New", phone: "222", familyLine: "Line B", generationNumber: "2", financialNotes: "New\nnotes",
    picturePath: "/objects/private-new", documents: [{ name: "new.pdf", objectPath: "/objects/private-doc-new", size: 20 }] };
  const changes = profileChanges(before, after, true, true);
  assert.equal(changes.length, 13);
  assert.deepEqual(changes.find(c => c.field === "Email"), change("Email", "old@example.com", null));
  assert.deepEqual(changes.find(c => c.field === "Financial information"), change("Financial information", "Old\nnotes", "New\nnotes"));
  assert.equal(changes.find(c => c.field === "SSN")?.protected, true);
  assert.ok(!JSON.stringify(changes).includes("/objects/"));
  assert.deepEqual(profileChanges(after, { ...after, ssnEncrypted: "must-not-log", ssnLast4: "1234", actor: "spoof" }, false, true), []);
  assert.deepEqual(profileChanges({ documents: [...after.documents].reverse() }, { documents: after.documents }, false, false), []);
  assert.ok(profileChanges(undefined, after, false, false).some(c => c.field === "Name" && c.before === null));
  const removed = profileChanges(after, { ...after, picturePath: "", documents: [] }, false, false);
  assert.ok(removed.some(c => c.field === "Picture" && c.after === null));
  assert.ok(removed.some(c => c.field === "Document removed"));
});

test("re-entering an unchanged secured SSN is not a content change", () => {
  const value = "999001234"; // Fictional verification value only.
  const encrypted = encryptSsn(value);
  assert.ok(matchesEncryptedSsn(encrypted, value));
  assert.ok(!matchesEncryptedSsn(encrypted, "999005678"));
  const history = profileChanges({}, {}, true, false);
  assert.equal(history[0].after, "Protected value added");
  assert.ok(!JSON.stringify(history).includes(value));
});

test("history persistence, actor snapshots, cursor isolation and atomicity", async t => {
  const schema = `history_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "shareholder_activity"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const transaction = <T,>(fn: (tx: Transaction) => Promise<T>) => db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
      return fn(tx);
    });
    await transaction(async tx => {
      await tx.insert(shareholdersTable).values([{ id: "owner", data: { name: "Owner" } }, { id: "other", data: { name: "Other" } }]);
    });
    await t.test("stored employee name and field values persist together", async () => {
      await auditContext.run({ id: "employee", name: "Verification Employee" }, () => transaction(async tx => {
        await recordActivity(tx, { shareholderId: "owner", name: "Owner", actor: "employee", action: "Record updated",
          changes: [change("Phone number", "111", "222")] });
      }));
      await transaction(async tx => {
        const result = await loadHistoryPage(tx, "owner");
        assert.equal(result.entries[0].actorName, "Verification Employee");
        assert.deepEqual(result.entries[0].changes, [change("Phone number", "111", "222")]);
      });
    });
    await t.test("failed transactions preserve both original profile and history", async () => {
      await assert.rejects(transaction(async tx => {
        await tx.update(shareholdersTable).set({ data: { name: "Changed" } }).where(eq(shareholdersTable.id, "owner"));
        await recordActivity(tx, { shareholderId: "owner", name: "Changed", actor: "employee", action: "Record updated",
          changes: [change("Name", "Owner", "Changed")] });
        throw new Error("intentional rollback");
      }), /intentional rollback/);
      await transaction(async tx => {
        const [owner] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, "owner"));
        assert.equal(owner.data.name, "Owner");
        assert.equal((await loadHistoryPage(tx, "owner")).entries.length, 1);
      });
    });
    await t.test("legacy summaries remain available without invented diffs", async () => {
      await transaction(async tx => {
        await tx.insert(activityTable).values({ id: "legacy", shareholderId: "other", name: "Other", actor: "old-employee", action: "Record updated" });
        const result = await loadHistoryPage(tx, "other");
        assert.equal(result.entries[0].changes, null);
        assert.equal(result.entries[0].actorName, null);
      });
    });
    await t.test("pagination loses no edits sharing a millisecond or timestamp", async () => {
      await transaction(async tx => {
        for (let i = 0; i < 102; i++) {
          // Microsecond timestamps exercise the precision lost by JS Date.
          await tx.execute(sql`INSERT INTO shareholder_activity (id,shareholder_id,name,action,actor,created_at)
            VALUES (${`rapid-${String(i).padStart(3, "0")}`},'owner','Owner','Record updated','employee',
              '2020-01-01 00:00:00.000000+00'::timestamptz + ${i} * interval '1 microsecond')`);
        }
        const first = await loadHistoryPage(tx, "owner");
        assert.equal(first.entries.length, 50);
        assert.ok(first.nextCursor);
        const second = await loadHistoryPage(tx, "owner", first.nextCursor!);
        assert.equal(second.entries.length, 50);
        const third = await loadHistoryPage(tx, "owner", second.nextCursor!);
        const ids = [...first.entries, ...second.entries, ...third.entries].map(r => r.id);
        assert.equal(ids.length, 103);
        assert.equal(new Set(ids).size, 103);
        assert.equal(third.nextCursor, null);
        await assert.rejects(loadHistoryPage(tx, "owner", "legacy"), e => e instanceof CertificateError && e.status === 400);
        await assert.rejects(loadHistoryPage(tx, "missing"), e => e instanceof CertificateError && e.status === 404);
      });
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
