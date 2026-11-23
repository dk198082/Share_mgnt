import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  db, pool, activityTable, certificateCountersTable, certificatesTable,
  settingsAuditTable, shareholdersTable,
} from "@workspace/db";
import { auditContext } from "./audit";
import { advanceCertificateCounter, readCertificateCounters } from "./certificate-counters";
import { CertificateError, issueCertificateInTransaction } from "./certificates";

test("certificate counters show ledger maxima, advance independently, audit changes, and serialize with issuance", async () => {
  const schema = `certificate_counter_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "certificates", "certificate_counters", "settings_audit", "shareholder_activity"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    async function transaction<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
      return db.transaction(async tx => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
        return fn(tx);
      });
    }
    const actor = { id: "counter-admin", name: "Counter Administrator" };
    await transaction(async tx => {
      await tx.insert(shareholdersTable).values({ id: "counter-owner", data: { name: "Synthetic Owner" } });
      await tx.insert(certificateCountersTable).values([
        { shareClass: "Common", lastNumber: 10 },
        { shareClass: "Preferred", lastNumber: 8 },
      ]);
      await tx.insert(certificatesTable).values([
        { id: "C-15", sequenceNumber: 15, shareholderId: "counter-owner", shareClass: "Common",
          quantity: 1, transferredQuantity: 0, issueDate: "2020-01-01", status: "Outstanding",
          vestingSchedule: "Legacy", requestId: "counter-test-common", issuedBy: "fixture" },
        { id: "P-3", sequenceNumber: 3, shareholderId: "counter-owner", shareClass: "Preferred",
          quantity: 1, transferredQuantity: 0, issueDate: "2020-01-01", status: "Outstanding",
          vestingSchedule: "Legacy", requestId: "counter-test-preferred", issuedBy: "fixture" },
      ]);
    });

    assert.deepEqual(await transaction(tx => readCertificateCounters(tx)), [
      { shareClass: "Common", lastIssuedNumber: 15, nextNumber: 16 },
      { shareClass: "Preferred", lastIssuedNumber: 3, nextNumber: 9 },
    ]);

    await assert.rejects(transaction(tx => advanceCertificateCounter(tx, "Common", 16, "No change")),
      error => error instanceof CertificateError && error.status === 409);
    await assert.rejects(transaction(tx => advanceCertificateCounter(tx, "Common", 20, "   ")),
      error => error instanceof CertificateError && error.status === 400);
    await assert.rejects(transaction(tx => advanceCertificateCounter(tx, "Common", 20, "No actor")),
      /Certificate counter changes require an authenticated employee identity/);

    await auditContext.run(actor, () => transaction(async tx => {
      await advanceCertificateCounter(tx, "Common", 30, "Preserve legacy certificate numbering");
      await advanceCertificateCounter(tx, "Preferred", 12, "Align with the preferred ledger");
    }));

    let releaseCounter!: () => void;
    let counterLocked!: () => void;
    const locked = new Promise<void>(resolve => { counterLocked = resolve; });
    const hold = new Promise<void>(resolve => { releaseCounter = resolve; });
    const adminAdvance = auditContext.run(actor, () => transaction(async tx => {
      await advanceCertificateCounter(tx, "Common", 40, "Reserve space for the next certificate batch");
      counterLocked();
      await hold;
    }));
    await locked;

    let issueStarted!: () => void;
    const issuing = new Promise<void>(resolve => { issueStarted = resolve; });
    const issue = transaction(async tx => {
      issueStarted();
      return issueCertificateInTransaction(tx, "counter-owner", {
        requestId: randomUUID(), shareClass: "Common", quantity: 2,
        issueDate: "2026-11-20", vestingSchedule: "Fully vested",
      }, "counter-admin");
    });
    await issuing;
    releaseCounter();
    const [issued] = await Promise.all([issue, adminAdvance]);
    assert.equal(issued.id, "C-40");

    const finalState = await transaction(tx => readCertificateCounters(tx));
    assert.deepEqual(finalState, [
      { shareClass: "Common", lastIssuedNumber: 40, nextNumber: 41 },
      { shareClass: "Preferred", lastIssuedNumber: 3, nextNumber: 12 },
    ]);
    const audit = await transaction(tx => tx.select().from(settingsAuditTable).orderBy(settingsAuditTable.createdAt));
    assert.equal(audit.length, 3);
    assert.ok(audit.every(row => row.actorId === actor.id && row.actorName === actor.name && row.outcome === "succeeded"));
    assert.ok(audit.some(row => row.changes.some(change => change.field === "Reason" && change.after === "Align with the preferred ledger")));
    const counter = await transaction(async tx => {
      const [row] = await tx.select().from(certificateCountersTable).where(eq(certificateCountersTable.shareClass, "Common"));
      return row;
    });
    assert.equal(counter.lastNumber, 40);
    assert.ok(await transaction(tx => tx.select().from(activityTable)).then(rows => rows.some(row => row.action.includes("C-40"))));
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
