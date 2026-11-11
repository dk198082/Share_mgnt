import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db, pool, settingsAuditTable, companySettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { auditContext, change } from "./audit";
import { externalSettingsChange, priceChanges, recordSettingsChange, signoffChanges, withAccessLock } from "./settings-audit";
import { loadSettingsAudit } from "../routes/settings-audit";

test("settings metadata is explicit, exact, and excludes signature paths and bytes", () => {
  const before = { name: "Signer", email: "signer@example.com", signaturePath: "https://private/old?token=secret" };
  const after = { ...before, signaturePath: "data:image/png;base64,private" };
  assert.deepEqual(signoffChanges(before, after), [change("Signature", "Signature on file", "Signature replaced", true)]);
  assert.deepEqual(signoffChanges(before, before), []);
  assert.deepEqual(signoffChanges(
    { ...before, emailNotificationsEnabled: true },
    { ...before, emailNotificationsEnabled: false },
  ), [change("Approval email notifications", "Enabled", "Disabled")]);
  assert.deepEqual(priceChanges({ commonPrice: "1.000000", preferredPrice: "0.000000" }, { common: "001.0", preferred: "0" }), []);
  assert.deepEqual(priceChanges(undefined, { common: "123456789012345678.123456", preferred: "0" }),
    [change("Common price", null, "123456789012345678.123456"), change("Preferred price", null, "0")]);
  assert.ok(!JSON.stringify(signoffChanges(before)).includes("secret"));
});

test("audit atomicity, attribution and external outcomes", async t => {
  const actor = `audit-test-${randomUUID()}`;
  const schema = `audit_checks_${randomUUID().replaceAll("-", "")}`;
  const input = { action: "Verification", targetId: "verification", changes: [change("Role", null, "hr")] };
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["settings_audit", "company_settings"]) await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await auditContext.run({ id: actor, name: "Event-time Employee" }, async () => {
      await t.test("local changes and audit roll back together", async () => {
        await assert.rejects(db.transaction(async tx => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
          await tx.insert(companySettingsTable).values({ id: "company", updatedBy: actor });
          await recordSettingsChange(tx, input);
          throw new Error("rollback");
        }), /rollback/);
        const counts = await pool.query(`SELECT (SELECT count(*) FROM "${schema}".settings_audit) AS audits, (SELECT count(*) FROM "${schema}".company_settings) AS settings`);
        assert.equal(counts.rows[0].audits, "0");
        assert.equal(counts.rows[0].settings, "0");
      });
      await t.test("pagination preserves identical timestamps and actor snapshots", async () => {
        await db.transaction(async tx => {
          await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
          for (let i = 0; i < 55; i++) await recordSettingsChange(tx, input);
          const first = await loadSettingsAudit(undefined, tx);
          assert.equal(first.entries.length, 50);
          assert.ok(first.nextCursor);
          const second = await loadSettingsAudit(first.nextCursor!, tx);
          assert.equal(second.entries.length, 5);
          assert.equal(second.nextCursor, null);
          assert.equal(new Set([...first.entries, ...second.entries].map(e => e.id)).size, 55);
          assert.ok(first.entries.every(e => e.actorName === "Event-time Employee"));
          await assert.rejects(loadSettingsAudit(randomUUID(), tx), /cursor not found/);
        });
      });
      await t.test("pending is durable before external call, then succeeded", async () => {
        const result = await externalSettingsChange(input, async () => {
          const rows = await db.select().from(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
          assert.equal(rows.length, 1);
          assert.equal(rows[0].outcome, "pending");
          assert.equal(rows[0].actorName, "Event-time Employee");
          return "done";
        });
        assert.equal(result, "done");
        const [event] = await db.select().from(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
        assert.equal(event.outcome, "succeeded");
        assert.ok(event.completedAt);
        await db.delete(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
      });
      await t.test("definite rejection fails without storing provider secrets", async () => {
        await assert.rejects(externalSettingsChange(input, async () => { throw { status: 422, message: "private-token" }; }));
        const [event] = await db.select().from(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
        assert.equal(event.outcome, "failed");
        assert.ok(!JSON.stringify(event).includes("private-token"));
        await db.delete(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
      });
      await t.test("ambiguous external failure stays pending", async () => {
        await assert.rejects(externalSettingsChange(input, async () => { throw new Error("network"); }), /outcome is unknown/);
        const [event] = await db.select().from(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
        assert.equal(event.outcome, "pending");
        assert.equal(event.completedAt, null);
        await db.delete(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
      });
      await t.test("audit insert failure never calls Clerk", async () => {
        const mock = t.mock.method(db, "insert", () => { throw new Error("database unavailable"); });
        let called = false;
        try {
          await assert.rejects(externalSettingsChange(input, async () => { called = true; }), /database unavailable/);
          assert.equal(called, false);
        } finally { mock.mock.restore(); }
      });
      await t.test("completion persistence failure does not claim rollback", async () => {
        const mock = t.mock.method(db, "update", () => { throw new Error("database unavailable"); });
        let called = false;
        try {
          await assert.rejects(externalSettingsChange(input, async () => { called = true; }), /change succeeded.*pending/);
          assert.equal(called, true);
          const [event] = await db.select().from(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
          assert.equal(event.outcome, "pending");
        } finally { mock.mock.restore(); }
      });
      await t.test("access lock serializes requests without starving audit writes", async () => {
        let active = 0;
        await Promise.all(Array.from({ length: 12 }, () => withAccessLock(async store => {
          active++;
          try {
            assert.equal(active, 1);
            await externalSettingsChange(input, async () => true, store);
          } finally { active--; }
        })));
      });
    });
  } finally {
    await db.delete(settingsAuditTable).where(eq(settingsAuditTable.actorId, actor));
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
