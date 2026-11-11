import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql, eq } from "drizzle-orm";
import { db, pool, certificatesTable, certificateCountersTable, shareholdersTable, shareTransfersTable, transferRequestsTable, signoffsTable } from "@workspace/db";
import { IssueCertificateBody, TransferSharesBody } from "@workspace/api-zod";
import { CertificateError, issueCertificateInTransaction, presentCertificate, outstandingTotal, remainingShares, type CertificateIssueInput } from "./certificates";
import { transferInTransaction, type TransferInput } from "./transfers";
import { requestTransfer, decideRequest as decideConfiguredRequest, presentRequest } from "./transfer-requests";
const decideRequest = (tx: Parameters<typeof decideConfiguredRequest>[0], id: string, actor: string, _oldRole: string, decision: "approve" | "reject") =>
  decideConfiguredRequest(tx, id, actor, [`${actor === "ceo-user" ? "first" : actor === "cfo-user" ? "second" : actor}@example.test`], decision);
import { TransferSharesResponse, GetTransferRequestResponse } from "@workspace/api-zod";

// Runs the real PostgreSQL allocation logic in an isolated schema. No live
// shareholder records or certificate counters are changed by these checks.
test("certificate ledger numbering and persistence", async (t) => {
  const schema = `certificate_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "certificates", "certificate_counters", "shareholder_activity", "share_transfers", "transfer_requests", "signoffs"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query(`ALTER TABLE "${schema}"."transfer_requests"
      ADD COLUMN IF NOT EXISTS "requester_email" text,
      ADD COLUMN IF NOT EXISTS "app_origin" text`);
    async function transaction<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
      return db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
        return fn(tx);
      });
    }
    await transaction(async tx => {
      await tx.insert(signoffsTable).values([
        { id: "first", name: "First signer", email: "first@example.test", signaturePath: "/objects/uploads/first", updatedBy: "admin" },
        { id: "second", name: "Second signer", email: "second@example.test", signaturePath: "/objects/uploads/second", updatedBy: "admin" },
      ]);
      await tx.insert(shareholdersTable).values({ id: "test-owner", data: { name: "Test owner" } });
    });
    const input = (shareClass: "Common" | "Preferred" = "Common"): CertificateIssueInput => ({
      requestId: randomUUID(), shareClass, quantity: 10, issueDate: "2026-01-01", vestingSchedule: "Fully vested upon grant",
    });
    const issue = (data: CertificateIssueInput) => transaction(tx => issueCertificateInTransaction(tx, "test-owner", data, "test"));

    await t.test("independent class sequences begin at one", async () => {
      assert.equal((await issue(input())).id, "C-1");
      assert.equal((await issue(input("Preferred"))).id, "P-1");
      assert.equal((await issue(input())).id, "C-2");
    });
    await t.test("simultaneous issuance cannot duplicate or skip committed numbers", async () => {
      const issued = await Promise.all(Array.from({ length: 8 }, (_, i) => issue(input(i % 2 ? "Preferred" : "Common"))));
      assert.equal(new Set(issued.map(r => r.id)).size, 8);
      assert.deepEqual(issued.filter(r => r.shareClass === "Common").map(r => r.sequenceNumber).sort((a,b) => a-b), [3,4,5,6]);
      assert.deepEqual(issued.filter(r => r.shareClass === "Preferred").map(r => r.sequenceNumber).sort((a,b) => a-b), [2,3,4,5]);
    });
    await t.test("concurrent retries issue only one certificate", async () => {
      const data = input();
      const rows = await Promise.all([issue(data), issue(data), issue(data)]);
      assert.deepEqual(rows.map(r => r.id), ["C-7", "C-7", "C-7"]);
      await assert.rejects(issue({ ...data, shareClass: "Preferred" }), (e: unknown) => e instanceof CertificateError && e.status === 409);
    });
    await t.test("failed issuance rolls back its counter", async () => {
      await assert.rejects(transaction(async tx => {
        await issueCertificateInTransaction(tx, "test-owner", input(), "test");
        throw new Error("intentional rollback");
      }), /intentional rollback/);
      assert.equal((await issue(input())).id, "C-8");
      await assert.rejects(transaction(tx => issueCertificateInTransaction(tx, "missing-owner", input("Preferred"), "test")),
        (e: unknown) => e instanceof CertificateError && e.status === 404);
      assert.equal((await issue(input("Preferred"))).id, "P-6");
    });
    await t.test("ordinary shareholder saves cannot change the certificate ledger", async () => {
      await transaction(async tx => {
        await tx.update(shareholdersTable).set({ data: { name: "Updated owner" } }).where(eq(shareholdersTable.id, "test-owner"));
        const rows = await tx.select().from(certificatesTable);
        assert.equal(rows.length, 14);
        assert.equal(outstandingTotal(rows), 140);
        const transferred = { ...rows[0], status: "Transferred" as const };
        const display = presentCertificate(transferred, 140);
        assert.equal(display.fullyDiluted, 0);
        assert.equal(display.percentFullyDiluted, 0);
        assert.ok(Math.abs(presentCertificate(rows[0], 140).percentFullyDiluted - 100 / 14) < 1e-9);
        const counters = await tx.select().from(certificateCountersTable);
        assert.equal(counters.find(r => r.shareClass === "Common")?.lastNumber, 8);
        assert.equal(counters.find(r => r.shareClass === "Preferred")?.lastNumber, 6);
      });
    });
    const transferInput = (quantity: number): TransferInput => ({
      recipientId: "recipient", quantity, transferDate: "2026-02-01", reason: "Gift", pricePerShare: "0", requestId: randomUUID(),
    });
    const transfer = (certificateId: string, data: TransferInput) =>
      transaction(tx => transferInTransaction(tx, "test-owner", certificateId, data, "test"));
    await transaction(async tx => {
      await tx.insert(shareholdersTable).values({ id: "recipient", data: { name: "Recipient", email: "", familyLine: "", generationNumber: "", documents: [] } });
    });
    await t.test("partial transfer conserves shares and creates a linked next-number certificate", async () => {
      const data = transferInput(4);
      const result = await transfer("C-1", data);
      assert.equal(result.recipientCertificateId, "C-9");
      assert.equal(result.sourceCertificateId, "C-1");
      await transaction(async tx => {
        const rows = await tx.select().from(certificatesTable);
        const source = rows.find(r => r.id === "C-1")!;
        const recipient = rows.find(r => r.id === "C-9")!;
        assert.equal(source.quantity, 10);
        assert.equal(source.transferredQuantity, 4);
        assert.equal(source.status, "Partially Transferred");
        assert.equal(remainingShares(source), 6);
        assert.equal(recipient.shareholderId, "recipient");
        assert.equal(recipient.status, "Outstanding");
        assert.equal(recipient.quantity, 4);
        assert.equal(recipient.vestingSchedule, source.vestingSchedule);
        assert.equal(recipient.issueDate, data.transferDate);
        assert.equal(outstandingTotal(rows), 140);
        assert.equal(presentCertificate(source, 140).fullyDiluted, 6);
      });
      assert.equal((await transfer("C-1", data)).id, result.id);
      await assert.rejects(transfer("C-1", { ...data, quantity: 3 }),
        (e: unknown) => e instanceof CertificateError && e.status === 409);
    });
    await t.test("full transfer closes the original and histories retain both certificate IDs", async () => {
      const result = await transfer("C-1", transferInput(6));
      assert.equal(result.recipientCertificateId, "C-10");
      await transaction(async tx => {
        const rows = await tx.select().from(certificatesTable);
        const source = rows.find(r => r.id === "C-1")!;
        assert.equal(source.status, "Transferred");
        assert.equal(source.quantity, 10);
        assert.equal(source.transferredQuantity, 10);
        assert.equal(remainingShares(source), 0);
        assert.equal(outstandingTotal(rows), 140);
        const history = await tx.select().from(shareTransfersTable);
        assert.equal(history.length, 2);
        assert.ok(history.every(r => r.originatorId === "test-owner" && r.recipientId === "recipient"));
      });
      await assert.rejects(transfer("C-1", transferInput(1)), (e: unknown) => e instanceof CertificateError && e.status === 409);
    });
    await t.test("concurrent transfers cannot overspend the source balance", async () => {
      const results = await Promise.allSettled([transfer("C-2", transferInput(7)), transfer("C-2", transferInput(7))]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
      await transaction(async tx => {
        const rows = await tx.select().from(certificatesTable);
        assert.equal(remainingShares(rows.find(r => r.id === "C-2")!), 3);
        assert.equal(outstandingTotal(rows), 140);
      });
    });
    await t.test("Preferred transfers use the Preferred sequence only", async () => {
      const result = await transfer("P-1", transferInput(10));
      assert.equal(result.recipientCertificateId, "P-7");
      await transaction(async tx => {
        const rows = await tx.select().from(certificateCountersTable);
        assert.equal(rows.find(r => r.shareClass === "Common")?.lastNumber, 11);
        assert.equal(rows.find(r => r.shareClass === "Preferred")?.lastNumber, 7);
      });
    });
    await t.test("new recipients and replayed transfers are atomic and create only one recipient", async () => {
      const data = { ...transferInput(10), recipientId: undefined, newRecipient: { name: "New recipient", email: "new@example.com" } };
      const results = await Promise.all([transfer("P-2", data), transfer("P-2", data)]);
      assert.equal(results[0].id, results[1].id);
      assert.equal(results[0].recipientCertificateId, "P-8");
      await transaction(async tx => {
        const owners = await tx.select().from(shareholdersTable);
        assert.equal(owners.length, 3);
        const row = owners.find(r => r.id === results[0].recipientId);
        assert.equal(row?.data.name, "New recipient");
        assert.equal(outstandingTotal(await tx.select().from(certificatesTable)), 140);
      });
    });
    await t.test("invalid recipients, quantities, dates and wrong originators make no changes", async () => {
      const badInputs: TransferInput[] = [
        { ...transferInput(1), recipientId: "test-owner" },
        { ...transferInput(1), recipientId: "missing" },
        { ...transferInput(1), transferDate: "2025-01-01" },
        { ...transferInput(1), transferDate: "2026-02-30" },
        { ...transferInput(1), recipientId: undefined },
        { ...transferInput(1), newRecipient: { name: "Ambiguous" } },
        { ...transferInput(1), recipientId: undefined, newRecipient: { name: "  " } },
        { ...transferInput(1), recipientId: undefined, newRecipient: { name: "Invalid", email: "bad" } },
        transferInput(0), transferInput(-1), transferInput(1.5), transferInput(11),
      ];
      for (const data of badInputs) await assert.rejects(transfer("C-3", data), (e: unknown) => e instanceof CertificateError);
      await assert.rejects(transaction(tx => transferInTransaction(tx, "recipient", "C-3", transferInput(1), "test")),
        (e: unknown) => e instanceof CertificateError);
      assert.equal(TransferSharesBody.strict().safeParse({ ...transferInput(1), pricePerShare: "-1" }).success, false);
      assert.equal(TransferSharesBody.strict().safeParse({ ...transferInput(1), pricePerShare: "1.1234567" }).success, false);
      await transaction(async tx => {
        const counters = await tx.select().from(certificateCountersTable);
        assert.equal(counters.find(r => r.shareClass === "Common")?.lastNumber, 11);
        assert.equal(counters.find(r => r.shareClass === "Preferred")?.lastNumber, 8);
      });
    });
    await t.test("rollback restores both owners, source balance, history and counter", async () => {
      await assert.rejects(transaction(async tx => {
        await transferInTransaction(tx, "test-owner", "C-3", {
          ...transferInput(5), recipientId: undefined, newRecipient: { name: "Rolled back" },
        }, "test");
        throw new Error("rollback transfer");
      }), /rollback transfer/);
      await transaction(async tx => {
        const certificates = await tx.select().from(certificatesTable);
        assert.equal(remainingShares(certificates.find(r => r.id === "C-3")!), 10);
        assert.equal(outstandingTotal(certificates), 140);
        assert.equal((await tx.select().from(shareholdersTable)).length, 3);
        assert.equal((await tx.select().from(shareTransfersTable)).length, 5);
        const counters = await tx.select().from(certificateCountersTable);
        assert.equal(counters.find(r => r.shareClass === "Common")?.lastNumber, 11);
      });
    });
    await t.test("invalid share quantities, classes and manual IDs are rejected", () => {
      assert.equal(IssueCertificateBody.safeParse({ ...input(), quantity: 0 }).success, false);
      assert.equal(IssueCertificateBody.safeParse({ ...input(), quantity: 1.2 }).success, false);
      assert.equal(IssueCertificateBody.safeParse({ ...input(), shareClass: "Other" }).success, false);
      assert.equal(IssueCertificateBody.strict().safeParse({ ...input(), id: "C-9000" }).success, false);
    });
    await t.test("CEO and CFO requests leave counters and holdings unchanged until both sign", async () => {
      const before = await transaction(tx => tx.select().from(certificatesTable));
      const counters = await transaction(tx => tx.select().from(certificateCountersTable));
      const data = transferInput(3);
      const requested = await transaction(tx => requestTransfer(tx, "test-owner", "C-3", data, "requester"));
      assert.equal(requested.status, "Pending");
      assert.equal(requested.ceoApprovedBy, null);
      assert.ok(TransferSharesResponse.safeParse(presentRequest(requested)).success);
      const retries = await Promise.all([1, 2].map(() => transaction(tx => requestTransfer(tx, "test-owner", "C-3", data, "requester"))));
      assert.ok(retries.every(r => r.id === requested.id));
      await assert.rejects(transaction(tx => requestTransfer(tx, "test-owner", "C-3", { ...data, quantity: 2 }, "requester")), /already used/);
      for (const [actor, role] of [["requester", "ceo"], ["employee", "hr"], ["admin", "admin"]]) {
        await assert.rejects(transaction(tx => decideRequest(tx, requested.id, actor, role, "approve")), (e: unknown) => e instanceof CertificateError && e.status === 403);
      }
      const first = await transaction(tx => decideRequest(tx, requested.id, "ceo-user", "ceo", "approve"));
      assert.equal(first.status, "Pending");
      assert.ok(first.approvals[0].approvedAt);
      assert.deepEqual(await transaction(tx => tx.select().from(certificateCountersTable)), counters);
      assert.deepEqual(await transaction(tx => tx.select().from(certificatesTable)), before);
      assert.equal((await transaction(tx => decideRequest(tx, requested.id, "ceo-user", "ceo", "approve"))).approvals[0].approvedAt, first.approvals[0].approvedAt);
      assert.equal((await transaction(tx => decideRequest(tx, requested.id, "ceo-user", "cfo", "approve"))).approvals.length, 1);
      const [completed, replay] = await Promise.all([1, 2].map(() => transaction(tx => decideRequest(tx, requested.id, "cfo-user", "cfo", "approve"))));
      assert.equal(completed.status, "Completed");
      assert.equal(completed.completedTransferId, replay.completedTransferId);
      assert.ok(GetTransferRequestResponse.safeParse(presentRequest(completed)).success);
      assert.equal((await transaction(tx => requestTransfer(tx, "test-owner", "C-3", data, "requester"))).status, "Completed");
      const after = await transaction(tx => tx.select().from(certificatesTable));
      assert.equal(after.length, before.length + 1);
      assert.equal(outstandingTotal(after), outstandingTotal(before));
      const source = after.find(c => c.id === "C-3")!;
      assert.equal(source.quantity, 10);
      assert.equal(source.status, "Partially Transferred");
      assert.equal(remainingShares(source), 7);
    });
    await t.test("rejection preserves history without allocating certificates or creating recipients", async () => {
      const before = await transaction(tx => tx.select().from(certificateCountersTable));
      const owners = await transaction(tx => tx.select().from(shareholdersTable));
      const data = { ...transferInput(1), recipientId: undefined, newRecipient: { name: "Pending new recipient" } };
      const row = await transaction(tx => requestTransfer(tx, "test-owner", "C-3", data, "requester"));
      await transaction(tx => decideRequest(tx, row.id, "cfo-user", "cfo", "approve"));
      const rejected = await transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "reject"));
      assert.equal(rejected.status, "Rejected");
      assert.equal(rejected.rejectedBy, "ceo-user");
      assert.equal((await transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "reject"))).status, "Rejected");
      await assert.rejects(transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "approve")), /rejected/);
      assert.deepEqual(await transaction(tx => tx.select().from(certificateCountersTable)), before);
      assert.deepEqual(await transaction(tx => tx.select().from(shareholdersTable)), owners);
    });
    await t.test("competing approvals recheck balance and roll back the losing second signature", async () => {
      const a = await transaction(tx => requestTransfer(tx, "test-owner", "C-3", transferInput(7), "requester"));
      const b = await transaction(tx => requestTransfer(tx, "test-owner", "C-3", transferInput(7), "requester"));
      await Promise.all([a, b].map(row => transaction(tx => decideRequest(tx, row.id, "cfo-user", "cfo", "approve"))));
      const before = await transaction(tx => tx.select().from(certificatesTable));
      const results = await Promise.allSettled([a, b].map(row => transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "approve"))));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
      const rows = await transaction(tx => tx.select().from(transferRequestsTable));
      const losing = rows.find(r => [a.id, b.id].includes(r.id) && r.status === "Pending")!;
      assert.equal(losing.ceoApprovedBy, null);
      const after = await transaction(tx => tx.select().from(certificatesTable));
      assert.equal(after.length, before.length + 1);
      assert.equal(after.find(c => c.id === "C-3")?.status, "Transferred");
      assert.equal(outstandingTotal(after), outstandingTotal(before));
    });
    await t.test("CFO first then CEO creates a new Preferred recipient exactly once", async () => {
      const data = { ...transferInput(10), recipientId: undefined, newRecipient: { name: "Approved new recipient", email: "approved@example.com" } };
      const source = await transaction(tx => issueCertificateInTransaction(tx, "test-owner", input("Preferred"), "test"));
      const row = await transaction(tx => requestTransfer(tx, "test-owner", source.id, data, "requester"));
      const ownersBefore = await transaction(tx => tx.select().from(shareholdersTable));
      await transaction(tx => decideRequest(tx, row.id, "cfo-user", "cfo", "approve"));
      const completed = await transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "approve"));
      assert.equal(completed.status, "Completed");
      assert.ok(completed.recipientCertificateId?.startsWith("P-"));
      await transaction(tx => decideRequest(tx, row.id, "ceo-user", "ceo", "approve"));
      const ownersAfter = await transaction(tx => tx.select().from(shareholdersTable));
      assert.equal(ownersAfter.length, ownersBefore.length + 1);
      assert.equal(ownersAfter.find(r => r.id === completed.recipientId)?.data.name, "Approved new recipient");
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
