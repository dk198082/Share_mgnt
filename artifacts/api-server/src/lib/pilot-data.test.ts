import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, eq, notInArray, inArray } from "drizzle-orm";
import {
  db, pool, shareholdersTable, certificatesTable, certificateCountersTable,
  shareTransfersTable, activityTable, settingsAuditTable,
} from "@workspace/db";
import { ImportPilotDataBody } from "@workspace/api-zod";
import { auditContext } from "./audit";
import { CertificateError, issueCertificateInTransaction, remainingShares, type Transaction } from "./certificates";
import { importPilotDataInTransaction, pilotDataStatus, PILOT_SHAREHOLDER_IDS, PILOT_DATA_MARKER } from "./pilot-data";

const actor = { id: "synthetic-pilot-importer", name: "Synthetic Pilot Importer" };
const tables = [
  "shareholders", "certificate_counters", "certificates", "share_transfers", "shareholder_activity",
  "settings_audit", "transfer_requests", "signoff_email_notifications", "signoff_result_email_notifications", "certificate_documents",
];
type Run = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
async function isolated(fn: (run: Run, schema: string) => Promise<void>) {
  const schema = `pilot_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of tables) await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    const run: Run = callback => auditContext.run(actor, () => db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
      return callback(tx);
    }));
    await fn(run, schema);
  } finally { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
}
const importData = (run: Run) => run(tx => importPilotDataInTransaction(tx, actor.id));

test("pilot import is explicit, atomic, non-destructive and replay safe", async t => {
  try {
    await t.test("confirmation rejects missing input and spoofed actor fields", () => {
      assert.equal(ImportPilotDataBody.strict().safeParse({}).success, false);
      assert.equal(ImportPilotDataBody.strict().safeParse({ confirmation: "yes" }).success, false);
      assert.equal(ImportPilotDataBody.strict().safeParse({ confirmation: "IMPORT FICTIONAL PILOT DATA", actor: "someone-else" }).success, false);
      assert.equal(ImportPilotDataBody.strict().safeParse({ confirmation: "IMPORT FICTIONAL PILOT DATA" }).success, true);
    });
    await t.test("preserves originals and uses fresh local certificate numbers without approvals, email or PDFs", () => isolated(async (run, schema) => {
      await run(async tx => {
        await tx.insert(shareholdersTable).values({ id: "original", data: { name: "Existing record", financialNotes: "Keep unchanged" }, ssnEncrypted: "opaque-existing-value", ssnLast4: "1234" });
        await issueCertificateInTransaction(tx, "original", { requestId: "original-common", shareClass: "Common", quantity: 10, issueDate: "2026-01-01", vestingSchedule: "Fully vested upon grant" }, actor.id);
        await issueCertificateInTransaction(tx, "original", { requestId: "original-preferred", shareClass: "Preferred", quantity: 20, issueDate: "2026-01-01", vestingSchedule: "Fully vested upon grant" }, actor.id);
        await tx.update(certificateCountersTable).set({ lastNumber: 100 }).where(eq(certificateCountersTable.shareClass, "Common"));
        await tx.update(certificateCountersTable).set({ lastNumber: 50 }).where(eq(certificateCountersTable.shareClass, "Preferred"));
      });
      const originals = await run(async tx => ({
        holders: await tx.select().from(shareholdersTable),
        certificates: await tx.select().from(certificatesTable),
        history: await tx.select().from(activityTable),
      }));
      assert.deepEqual(await run(pilotDataStatus), { state: "available", pilotShareholders: 0 });
      assert.deepEqual(await importData(run), { alreadyImported: false, shareholdersAdded: 12, certificatesAdded: 27, transfersAdded: 3 });
      await run(async tx => {
        assert.deepEqual(await pilotDataStatus(tx), { state: "imported", pilotShareholders: 12 });
        assert.deepEqual(await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, "original")), originals.holders);
        assert.deepEqual(await tx.select().from(certificatesTable).where(eq(certificatesTable.shareholderId, "original")), originals.certificates);
        assert.deepEqual(await tx.select().from(activityTable).where(eq(activityTable.shareholderId, "original")), originals.history);
        const holders = await tx.select().from(shareholdersTable).where(inArray(shareholdersTable.id, PILOT_SHAREHOLDER_IDS));
        assert.ok(holders.every(h => String(h.data.name).startsWith("PILOT — ") && !h.ssnEncrypted && !h.ssnLast4));
        const certificates = await tx.select().from(certificatesTable).where(notInArray(certificatesTable.shareholderId, ["original"]));
        assert.equal(certificates.length, 27);
        assert.equal(certificates.reduce((sum, c) => sum + remainingShares(c), 0), 21450);
        assert.ok(certificates.some(c => c.id === "C-101"));
        assert.ok(certificates.some(c => c.id === "P-51"));
        assert.ok(certificates.filter(c => c.shareClass === "Common").every(c => c.sequenceNumber > 100));
        assert.ok(certificates.filter(c => c.shareClass === "Preferred").every(c => c.sequenceNumber > 50));
        const transfers = await tx.select().from(shareTransfersTable);
        assert.equal(transfers.length, 3);
        const audit = await tx.select().from(settingsAuditTable);
        assert.equal(audit.length, 1);
        assert.equal(audit[0].actorId, actor.id);
        assert.equal(audit[0].actorName, actor.name);
      });
      for (const table of ["transfer_requests", "signoff_email_notifications", "signoff_result_email_notifications", "certificate_documents"]) {
        const result = await pool.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
        assert.equal(result.rows[0].n, 0);
      }
    }));
    await t.test("concurrent imports and later retries add no duplicates or overwrite edited pilot records", () => isolated(async run => {
      const results = await Promise.all([importData(run), importData(run), importData(run)]);
      assert.equal(results.filter(r => !r.alreadyImported).length, 1);
      await run(tx => tx.update(shareholdersTable).set({ data: { name: "Edited pilot name", email: "edited@example.invalid" } }).where(eq(shareholdersTable.id, PILOT_SHAREHOLDER_IDS[0])));
      assert.deepEqual(await importData(run), { alreadyImported: true, shareholdersAdded: 0, certificatesAdded: 0, transfersAdded: 0 });
      await run(async tx => {
        assert.equal((await tx.select().from(shareholdersTable)).length, 12);
        assert.equal((await tx.select().from(certificatesTable)).length, 27);
        assert.equal((await tx.select().from(shareTransfersTable)).length, 3);
        assert.equal((await tx.select().from(settingsAuditTable)).length, 1);
        assert.equal((await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, PILOT_SHAREHOLDER_IDS[0])))[0].data.name, "Edited pilot name");
      });
    }));
    await t.test("partial datasets are blocked without overwriting the colliding record", () => isolated(async run => {
      await run(tx => tx.insert(shareholdersTable).values({ id: PILOT_SHAREHOLDER_IDS[0], data: { name: "Preserve me" } }));
      assert.deepEqual(await run(pilotDataStatus), { state: "conflict", pilotShareholders: 1 });
      await assert.rejects(importData(run), error => error instanceof CertificateError && error.status === 409);
      await run(async tx => {
        assert.equal((await tx.select().from(shareholdersTable))[0].data.name, "Preserve me");
        assert.equal((await tx.select().from(certificatesTable)).length, 0);
        assert.equal((await tx.select().from(activityTable)).length, 0);
      });
    }));
    await t.test("a failure halfway through rolls back holders, ledger, counters, audit and marker together", () => isolated(async (run, schema) => {
      await pool.query(`CREATE FUNCTION "${schema}".reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id = 'pilot-shareholder-006' THEN RAISE EXCEPTION 'synthetic fixture failure'; END IF; RETURN NEW; END $$`);
      await pool.query(`CREATE TRIGGER reject_fixture BEFORE INSERT ON "${schema}".shareholders FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_fixture()`);
      await assert.rejects(importData(run), /synthetic fixture failure|Failed query/);
      for (const table of tables) {
        const result = await pool.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
        assert.equal(result.rows[0].n, 0, `${table} must roll back`);
      }
      await pool.query(`DROP TRIGGER reject_fixture ON "${schema}".shareholders`);
      await importData(run);
      assert.deepEqual(await run(pilotDataStatus), { state: "imported", pilotShareholders: 12 });
      const marker = await run(tx => tx.select().from(activityTable).where(eq(activityTable.id, PILOT_DATA_MARKER)));
      assert.equal(marker.length, 1);
      assert.equal(marker[0].actorName, actor.name);
    }));
  } finally { await pool.end(); }
});
