import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, shareholdersTable, certificatesTable, certificateCountersTable, shareTransfersTable,
  transferRequestsTable, signoffsTable } from "@workspace/db";
import { issueCertificateInTransaction, outstandingTotal, remainingShares, type Transaction } from "./certificates";
import { transferInTransaction, type TransferInput } from "./transfers";
import { requestTransfer, decideRequest } from "./transfer-requests";
import { buildReport } from "./report-data";
import { certificateDirectory } from "./directories";
import { TransferSharesBody } from "@workspace/api-zod";

test("batch transfers are atomic, approved once, and reconcile every source", async t => {
  const schema = `batch_checks_${randomUUID().replaceAll("-", "")}`;
  const tx = <T,>(fn: (transaction: Transaction) => Promise<T>) => db.transaction(async transaction => {
    await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
    return fn(transaction);
  });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "certificates", "certificate_counters", "shareholder_activity",
      "share_transfers", "transfer_requests", "signoffs", "signoff_email_notifications", "signoff_result_email_notifications"])
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await tx(async transaction => {
      await transaction.insert(shareholdersTable).values([{ id: "owner", data: { name: "Owner" } }, { id: "recipient", data: { name: "Recipient" } }]);
      await transaction.insert(signoffsTable).values(["first", "second"].map(id => ({
        id, name: id, email: `${id}@example.test`, signaturePath: `/objects/signature-${id}`, updatedBy: "fixture",
      })));
    });
    const issue = (shareClass: "Common" | "Preferred", quantity: number, owner = "owner", vestingSchedule = "Fully vested upon grant") =>
      tx(transaction => issueCertificateInTransaction(transaction, owner, {
        requestId: randomUUID(), shareClass, quantity, issueDate: "2026-01-01", vestingSchedule,
      }, "fixture"));
    const input = (a: string, aq: number, b: string, bq: number): TransferInput => ({
      requestId: randomUUID(), recipientId: "recipient", quantity: aq + bq, transferDate: "2026-02-01",
      reason: "Gift", pricePerShare: "12.50", sources: [{ certificateId: a, quantity: aq }, { certificateId: b, quantity: bq }],
    });
    const approve = (id: string, signer: string) => tx(transaction =>
      decideRequest(transaction, id, signer, [`${signer}@example.test`], "approve"));
    const snapshot = () => tx(async transaction => ({
      certificates: await transaction.select().from(certificatesTable).orderBy(certificatesTable.id),
      counters: await transaction.select().from(certificateCountersTable).orderBy(certificateCountersTable.shareClass),
      transfers: await transaction.select().from(shareTransfersTable).orderBy(shareTransfersTable.id),
    }));
    const a = await issue("Common", 10), b = await issue("Common", 20), p = await issue("Preferred", 10);
    await t.test("one request, all signers, one certificate, partial/full source status, safe retries", async () => {
      const data = input(a.id, 4, b.id, 20), before = await snapshot();
      assert.ok(TransferSharesBody.safeParse(data).success);
      const request = await tx(transaction => requestTransfer(transaction, "owner", a.id, data, "first"));
      const replay = await tx(transaction => requestTransfer(transaction, "owner", a.id, { ...data, sources: [...data.sources!].reverse() }, "first"));
      assert.equal(replay.id, request.id);
      await assert.rejects(tx(transaction => requestTransfer(transaction, "owner", a.id,
        { ...data, sources: [{ certificateId: a.id, quantity: 5 }, { certificateId: b.id, quantity: 19 }] }, "first")), /Request key/);
      await approve(request.id, "first");
      assert.deepEqual(await snapshot(), before, "pending and first approval cannot change holdings or numbers");
      const completed = await approve(request.id, "second");
      assert.equal(completed.status, "Completed");
      const after = await snapshot();
      assert.equal(after.certificates.length, before.certificates.length + 1);
      assert.equal(after.transfers.length, 1);
      const recipient = after.certificates.find(c => c.id === completed.recipientCertificateId)!;
      assert.equal(recipient.quantity, 24);
      assert.equal(recipient.shareholderId, "recipient");
      assert.equal(after.certificates.find(c => c.id === a.id)!.status, "Partially Transferred");
      assert.equal(remainingShares(after.certificates.find(c => c.id === a.id)!), 6);
      assert.equal(after.certificates.find(c => c.id === b.id)!.status, "Transferred");
      assert.equal(outstandingTotal(after.certificates), outstandingTotal(before.certificates));
      assert.deepEqual(after.transfers[0].sources, data.sources);
      await approve(request.id, "second");
      await tx(transaction => transferInTransaction(transaction, "owner", a.id, data, "second"));
      assert.deepEqual(await snapshot(), after);
      const holders = await tx(transaction => transaction.select().from(shareholdersTable));
      const directory = certificateDirectory(after.certificates, holders, after.transfers);
      assert.equal(directory.find(c => c.id === a.id)!.successors[0].quantity, 4);
      assert.equal(directory.find(c => c.id === b.id)!.successors[0].quantity, 20);
      const source = { holders, certificates: after.certificates, transfers: after.transfers };
      const cap = buildReport("detailed-cap-table", source, {}, "fixture");
      assert.deepEqual(cap.sheets[1].rows.map(r => [r[1], r[3], r[4]]), [["Owner", 6, 10], ["Recipient", 24, 0]]);
      const historical = buildReport("detailed-cap-table", source, { asOfDate: "2026-01-15" }, "fixture");
      assert.equal(historical.sheets[1].rows.find(r => r[1] === "Owner")![3], 30);
      const events = buildReport("shareholder-transactions", source, {}, "fixture").sheets[0].rows;
      assert.equal(events.filter(r => String(r[2]).includes("transferred in")).length, 1);
      assert.ok(JSON.stringify(events).includes(b.id));
    });
    await t.test("mixed classes, owners, schedules, duplicate IDs, mismatched totals, dates and overdrafts fail without changes", async () => {
      const other = await issue("Common", 10, "recipient");
      const different = await issue("Common", 10, "owner", "Different terms");
      const before = await snapshot();
      const invalid = [
        input(a.id, 1, p.id, 1), input(a.id, 1, other.id, 1), input(a.id, 1, different.id, 1),
        input(a.id, 1, a.id, 1), input(a.id, 99, b.id, 1),
        { ...input(a.id, 1, p.id, 1), quantity: 99 },
        { ...input(a.id, 1, p.id, 1), transferDate: "2025-12-31" },
        { ...input(a.id, 1, p.id, 1), sources: [] },
        { ...input(a.id, 1, p.id, 1), sources: [{ certificateId: a.id, quantity: -1 }, { certificateId: p.id, quantity: 3 }] },
      ];
      for (const data of invalid)
        await assert.rejects(tx(transaction => requestTransfer(transaction, "owner", a.id, data, "first")));
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("one depleted source rolls back final vote, recipient, balances and certificate number", async () => {
      const c = await issue("Common", 10), d = await issue("Common", 10);
      const data = { ...input(c.id, 10, d.id, 10), recipientId: undefined, newRecipient: { name: "New recipient" } };
      const request = await tx(transaction => requestTransfer(transaction, "owner", c.id, data, "first"));
      await approve(request.id, "first");
      await tx(transaction => transferInTransaction(transaction, "owner", d.id, {
        requestId: randomUUID(), quantity: 1, recipientId: "recipient", transferDate: "2026-02-01",
      }, "fixture"));
      const before = await snapshot();
      const holdersBefore = await tx(transaction => transaction.select().from(shareholdersTable));
      await assert.rejects(approve(request.id, "second"), /remain/);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await tx(transaction => transaction.select().from(shareholdersTable)), holdersBefore);
      const [stillPending] = await tx(transaction => transaction.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, request.id)));
      assert.equal(stillPending.status, "Pending");
      assert.equal(stillPending.approvals.length, 1);
      assert.equal(stillPending.recipientCertificateId, null);
    });
    await t.test("overlapping batches lock their sources consistently and cannot spend the same shares twice", async () => {
      const e = await issue("Common", 8), f = await issue("Common", 12);
      const before = await snapshot();
      const results = await Promise.allSettled([
        tx(transaction => transferInTransaction(transaction, "owner", e.id, input(e.id, 8, f.id, 12), "fixture")),
        tx(transaction => transferInTransaction(transaction, "owner", f.id, input(f.id, 12, e.id, 8), "fixture")),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
      const after = await snapshot();
      assert.equal(after.certificates.length, before.certificates.length + 1);
      assert.equal(after.transfers.length, before.transfers.length + 1);
      assert.equal(outstandingTotal(after.certificates), outstandingTotal(before.certificates));
      assert.equal(remainingShares(after.certificates.find(c => c.id === e.id)!), 0);
      assert.equal(remainingShares(after.certificates.find(c => c.id === f.id)!), 0);
    });
    await t.test("Preferred consolidation and concurrent retries create only one new recipient and certificate", async () => {
      const q = await issue("Preferred", 20);
      const data = { ...input(p.id, 2, q.id, 3), recipientId: undefined, newRecipient: { name: "Preferred recipient" } };
      const before = await snapshot();
      const [one, two] = await Promise.all([1, 2].map(() => tx(transaction => transferInTransaction(transaction, "owner", p.id, data, "fixture"))));
      assert.equal(one.id, two.id);
      const after = await snapshot();
      assert.equal(after.certificates.length, before.certificates.length + 1);
      assert.equal(after.certificates.find(c => c.id === one.recipientCertificateId)!.quantity, 5);
      assert.ok(one.recipientCertificateId.startsWith("P-"));
      assert.equal(after.counters.find(c => c.shareClass === "Common")!.lastNumber, before.counters.find(c => c.shareClass === "Common")!.lastNumber);
      assert.equal(outstandingTotal(after.certificates), outstandingTotal(before.certificates));
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
