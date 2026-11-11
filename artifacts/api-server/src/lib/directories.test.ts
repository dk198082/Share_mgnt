import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, shareholdersTable, certificatesTable, shareTransfersTable, activityTable, signoffsTable, type TransferRequestRow } from "@workspace/db";
import { AttachTransferFilesBody, TransferSharesBody } from "@workspace/api-zod";
import { CertificateError, issueCertificateInTransaction, outstandingTotal, type Transaction } from "./certificates";
import { requestTransfer, decideRequest as decideConfiguredRequest } from "./transfer-requests";
const decideRequest = (tx: Parameters<typeof decideConfiguredRequest>[0], id: string, actor: string, _oldRole: string, decision: "approve" | "reject") =>
  decideConfiguredRequest(tx, id, actor, [`${actor}@example.test`], decision);
import { appendRequestDocuments, appendTransferDocuments, mergeTransferDocuments } from "./transfer-attachments";
import { certificateDirectory, needsSignoff as needsConfiguredSignoff } from "./directories";
const needsSignoff = (row: TransferRequestRow, actor: string, oldRole: string) =>
  needsConfiguredSignoff(row, actor, [`${actor}@example.test`]);

const doc = (name: string) => ({ name, objectPath: `/objects/uploads/${name}`, size: 5 });
test("attachment bounds and stable append-only metadata", () => {
  assert.equal(mergeTransferDocuments([doc("a.txt")], [doc("a.txt")]).added.length, 0);
  assert.throws(() => mergeTransferDocuments([doc("a.txt")], [{ ...doc("a.txt"), name: "renamed.txt" }]), CertificateError);
  assert.throws(() => mergeTransferDocuments(Array.from({ length: 20 }, (_, i) => doc(`${i}.txt`)), [doc("21.txt")]), CertificateError);
  assert.equal(AttachTransferFilesBody.strict().safeParse({ attachments: [] }).success, false);
  assert.equal(AttachTransferFilesBody.strict().safeParse({ attachments: [doc("a")], actor: "spoof" }).success, false);
  assert.equal(TransferSharesBody.safeParse({ quantity: 1, transferDate: "2026-01-02", requestId: randomUUID(),
    recipientId: "recipient", attachments: Array.from({ length: 21 }, (_, i) => doc(`${i}`)) }).success, false);
});
test("directories, approval queue and transfer document lifecycle", async t => {
  const schema = `directory_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "certificate_counters", "certificates", "share_transfers", "transfer_requests", "shareholder_activity", "signoffs"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query(`ALTER TABLE "${schema}"."transfer_requests"
      ADD COLUMN IF NOT EXISTS "requester_email" text,
      ADD COLUMN IF NOT EXISTS "app_origin" text`);
    const transaction = <T,>(fn: (tx: Transaction) => Promise<T>) => db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
      return fn(tx);
    });
    await transaction(async tx => {
      await tx.insert(signoffsTable).values([
        { id: "first", name: "First signer", email: "ceo@example.test", signaturePath: "/objects/uploads/first", updatedBy: "admin" },
        { id: "second", name: "Second signer", email: "cfo@example.test", signaturePath: "/objects/uploads/second", updatedBy: "admin" },
      ]);
      await tx.insert(shareholdersTable).values([{ id: "origin", data: { name: "Originator" } }, { id: "recipient", data: { name: "Recipient" } }]);
      await issueCertificateInTransaction(tx, "origin", { requestId: randomUUID(), quantity: 10, shareClass: "Common",
        issueDate: "2026-01-01", vestingSchedule: "Fully vested upon grant" }, "creator");
    });
    const input = { requestId: randomUUID(), quantity: 10, recipientId: "recipient", transferDate: "2026-01-02", attachments: [doc("first.txt")] };
    let request: TransferRequestRow;
    await t.test("creation preserves the review bundle and server determines who needs to sign", async () => {
      request = await transaction(tx => requestTransfer(tx, "origin", "C-1", input, "creator"));
      assert.deepEqual(request.input.attachments, [doc("first.txt")]);
      assert.ok(needsSignoff(request, "ceo", "ceo"));
      assert.ok(needsSignoff(request, "cfo", "cfo"));
      assert.ok(!needsSignoff(request, "creator", "ceo"));
      assert.ok(!needsSignoff(request, "admin", "admin"));
      assert.ok(!needsSignoff(request, "employee", "hr"));
    });
    await t.test("only requester/admin may append, retries preserve all attachments", async () => {
      await assert.rejects(transaction(tx => appendRequestDocuments(tx, request.id, [doc("second.txt")], "other", "finance")),
        e => e instanceof CertificateError && e.status === 403);
      request = await transaction(tx => appendRequestDocuments(tx, request.id, [doc("second.txt")], "creator", "hr"));
      assert.equal(request.input.attachments?.length, 2);
      const replay = await transaction(tx => requestTransfer(tx, "origin", "C-1", input, "creator"));
      assert.equal(replay.input.attachments?.length, 2);
      await assert.rejects(transaction(tx => requestTransfer(tx, "origin", "C-1", { ...input, attachments: [doc("changed.txt")] }, "creator")),
        e => e instanceof CertificateError && e.status === 409);
    });
    await t.test("first approval locks the bundle and removes only that executive's pending item", async () => {
      request = await transaction(tx => decideRequest(tx, request.id, "ceo", "ceo", "approve"));
      assert.ok(!needsSignoff(request, "ceo", "ceo"));
      assert.ok(needsSignoff(request, "cfo", "cfo"));
      assert.ok(!needsSignoff(request, "ceo", "cfo"));
      await assert.rejects(transaction(tx => appendRequestDocuments(tx, request.id, [doc("late.txt")], "admin", "admin")),
        e => e instanceof CertificateError && e.status === 409);
      await transaction(async tx => {
        const certificates = await tx.select().from(certificatesTable);
        assert.equal(certificates.length, 1);
        assert.equal(outstandingTotal(certificates), 10);
      });
    });
    await t.test("completion carries documents, conserves shares and displays the actual current holder", async () => {
      request = await transaction(tx => decideRequest(tx, request.id, "cfo", "cfo", "approve"));
      assert.equal(request.status, "Completed");
      assert.ok(!needsSignoff(request, "cfo", "cfo"));
      await transaction(async tx => {
        const transfers = await tx.select().from(shareTransfersTable);
        assert.deepEqual(transfers[0].attachments, [doc("first.txt"), doc("second.txt")]);
        const certificates = await tx.select().from(certificatesTable);
        const holders = await tx.select().from(shareholdersTable);
        const directory = certificateDirectory(certificates, holders, transfers);
        const old = directory.find(c => c.id === "C-1")!, current = directory.find(c => c.id === "C-2")!;
        assert.equal(old.status, "Transferred");
        assert.equal(old.currentHolderId, null);
        assert.equal(old.originalHolderId, "origin");
        assert.equal(old.successors[0].certificateId, "C-2");
        assert.equal(current.currentHolderId, "recipient");
        assert.equal(current.currentHolderName, "Recipient");
        assert.equal(current.remainingQuantity, 10);
        assert.equal(outstandingTotal(certificates), 10);
      });
    });
    await t.test("supporting files append after completion without changing the signed request bundle", async () => {
      const transfer = await transaction(tx => appendTransferDocuments(tx, request.completedTransferId!, [doc("support.txt")], "employee"));
      assert.equal(transfer.attachments.length, 3);
      assert.equal(request.input.attachments?.length, 2);
      const count = await transaction(async tx => (await tx.select().from(activityTable)).length);
      const replay = await transaction(tx => appendTransferDocuments(tx, transfer.id, [doc("support.txt")], "employee"));
      assert.equal(replay.attachments.length, 3);
      await transaction(async tx => {
        assert.equal((await tx.select().from(activityTable)).length, count);
        const rows = await tx.select().from(activityTable).where(eq(activityTable.actor, "employee"));
        assert.deepEqual(rows.map(r => r.shareholderId).sort(), ["origin", "recipient"]);
        assert.ok(rows.every(r => JSON.stringify(r.changes).includes("support.txt") && !JSON.stringify(r.changes).includes("/objects/")));
      });
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
