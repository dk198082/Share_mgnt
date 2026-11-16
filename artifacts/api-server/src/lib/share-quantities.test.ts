import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, certificatesTable, shareholdersTable, shareTransfersTable, signoffsTable } from "@workspace/db";
import { IssueCertificateBody, TransferSharesBody } from "@workspace/api-zod";
import { addShares, isShareQuantity, parseShareQuantity, shareUnits, subtractShares, sumShares } from "@workspace/share-quantities";
import { issueCertificateInTransaction, outstandingTotal, remainingShares } from "./certificates";
import { transferInTransaction, inputSources } from "./transfers";
import { requestIssuance } from "./issuance-requests";
import { decideRequest, requestTransfer } from "./transfer-requests";
import { buildReport } from "./report-data";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderCertificatePdf } from "./certificate-pdf";

test("two-decimal validation rejects excess precision instead of rounding", () => {
  for (const q of [0.01, 0.1, 0.29, 1, 1.5, 12.34, 999999999999.99, 1e12]) {
    assert.equal(isShareQuantity(q), true);
    assert.equal(IssueCertificateBody.safeParse({ requestId: randomUUID(), shareClass: "Common", quantity: q, issueDate: "1946-01-01", vestingSchedule: "Legacy" }).success, true);
    assert.equal(TransferSharesBody.safeParse({ requestId: randomUUID(), recipientId: "recipient", quantity: q, transferDate: "2026-01-01" }).success, true);
  }
  for (const q of [0, -0.01, 1.001, 0.001, 0.1 + 0.2, NaN, Infinity, 1000000000000.01]) {
    assert.equal(isShareQuantity(q), false);
    assert.equal(IssueCertificateBody.safeParse({ requestId: randomUUID(), shareClass: "Preferred", quantity: q, issueDate: "1946-01-01", vestingSchedule: "Legacy" }).success, false);
    assert.equal(TransferSharesBody.safeParse({ requestId: randomUUID(), recipientId: "recipient", quantity: q, transferDate: "2026-01-01" }).success, false);
  }
  for (const value of ["1.001", "1.000", "1e2", "1,000.00", "", "-1", "Infinity"])
    assert.equal(parseShareQuantity(value), null);
  assert.equal(parseShareQuantity(" 0.01 "), 0.01);
  assert.equal(addShares(0.1, 0.2), 0.3);
  assert.equal(subtractShares(0.3, 0.1), 0.2);
  assert.equal(sumShares(Array.from({ length: 100 }, () => 0.01)), 1);
  assert.equal(sumShares([1e12, -0.01]), 999999999999.99);
  assert.throws(() => shareUnits(1.001));
  assert.throws(() => inputSources("C-1", { requestId: randomUUID(), recipientId: "r", quantity: 0.3, transferDate: "2026-01-01",
    sources: [{ certificateId: "C-1", quantity: 0.101 }, { certificateId: "C-2", quantity: 0.199 }] }));
});

test("fractional issuance, approval, batch/partial/full transfers, retries and reports conserve each class", async () => {
  await db.transaction(async tx => {
    await tx.insert(shareholdersTable).values([
      { id: "fraction-owner", data: { name: "Synthetic Fraction Source" } },
      { id: "fraction-recipient", data: { name: "Synthetic Fraction Recipient" } },
    ]);
    await tx.insert(signoffsTable).values({ id: "fraction-signer", name: "Synthetic Signer", email: "fraction@example.test", signaturePath: "/objects/synthetic-signature", updatedBy: "synthetic" });
    await assert.rejects(requestIssuance(tx, "fraction-owner", {
      requestId: randomUUID(), shareClass: "Common", quantity: 1.001,
      issueDate: "1946-01-01", vestingSchedule: "Legacy",
    }, "synthetic"), /2 decimal/);
    for (const shareClass of ["Common", "Preferred"] as const) {
      const issue = (quantity: number) => issueCertificateInTransaction(tx, "fraction-owner", {
        requestId: randomUUID(), shareClass, quantity, issueDate: "1946-01-01", vestingSchedule: "Fully vested upon grant",
      }, "synthetic");
      const first = await issue(0.1);
      const second = await issue(0.2);
      const third = await issue(1.01);
      const input = { requestId: randomUUID(), recipientId: "fraction-recipient", quantity: 0.3,
        transferDate: "2026-01-01", sources: [{ certificateId: first.id, quantity: 0.1 }, { certificateId: second.id, quantity: 0.2 }], pricePerShare: "12.345678" };
      const batch = await transferInTransaction(tx, "fraction-owner", first.id, input, "synthetic");
      assert.equal((await transferInTransaction(tx, "fraction-owner", first.id, input, "synthetic")).id, batch.id);
      const partial = await transferInTransaction(tx, "fraction-owner", third.id,
        { requestId: randomUUID(), recipientId: "fraction-recipient", quantity: 0.01, transferDate: "2026-01-01" }, "synthetic");
      assert.equal(partial.quantity, 0.01);
      const afterPartial = (await tx.select().from(certificatesTable).where(eq(certificatesTable.id, third.id)))[0];
      assert.equal(remainingShares(afterPartial), 1);
      assert.equal(afterPartial.status, "Partially Transferred");
      await transferInTransaction(tx, "fraction-owner", third.id,
        { requestId: randomUUID(), recipientId: "fraction-recipient", quantity: 1, transferDate: "2026-01-02" }, "synthetic");
      const final = (await tx.select().from(certificatesTable).where(eq(certificatesTable.id, third.id)))[0];
      assert.equal(final.transferredQuantity, 1.01);
      assert.equal(remainingShares(final), 0);
      assert.equal(final.status, "Transferred");

      const request = await requestIssuance(tx, "fraction-owner", {
        requestId: randomUUID(), shareClass, quantity: 0.29, issueDate: "2026-01-02", vestingSchedule: "Fully vested upon grant",
      }, "synthetic");
      const approved = await decideRequest(tx, request.id, "synthetic", ["fraction@example.test"], "approve");
      assert.equal(approved.status, "Completed");
      const issuance = (await tx.select().from(certificatesTable).where(eq(certificatesTable.id, approved.recipientCertificateId!)))[0];
      assert.equal(issuance.quantity, 0.29);
      const transferRequest = await requestTransfer(tx, "fraction-owner", issuance.id,
        { requestId: randomUUID(), recipientId: "fraction-recipient", quantity: 0.09, transferDate: "2026-01-03" }, "synthetic");
      assert.equal((await decideRequest(tx, transferRequest.id, "synthetic", ["fraction@example.test"], "approve")).status, "Completed");
      const rows = await tx.select().from(certificatesTable);
      assert.equal(outstandingTotal(rows.filter(c => c.shareClass === shareClass)), 1.6);
    }
    const holders = await tx.select().from(shareholdersTable);
    const certificates = await tx.select().from(certificatesTable);
    const transfers = await tx.select().from(shareTransfersTable);
    const source = { holders, certificates, transfers };
    const report = buildReport("detailed-cap-table", source, { asOfDate: "2026-01-03" }, "Synthetic");
    assert.equal(report.sheets[0].rows[0][2], 1.6);
    assert.equal(report.sheets[0].rows[1][2], 1.6);
    assert.equal(report.sheets[0].rows[2][2], 3.2);
    const commonSheet = report.sheets.find(s => s.name === "C-Common")!;
    const considerationColumn = commonSheet.columns.findIndex(c => c.label === "Amount Paid for Transfer");
    assert.ok(commonSheet.rows.some(r => r[considerationColumn] === 1.2345678));
    assert.ok(buildReport("shareholder-transactions", source, { asOfDate: "2026-01-03" }, "Synthetic").sheets[0].rows.length);
    // All synthetic rows disappear; keep only the test fixture's own cluster.
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
  });
});

test("concurrent fractional transfers cannot spend the same available shares", async () => {
  const owner = "fraction-concurrent-owner";
  const recipient = "fraction-concurrent-recipient";
  await db.insert(shareholdersTable).values([
    { id: owner, data: { name: "Synthetic Concurrent Source" } },
    { id: recipient, data: { name: "Synthetic Concurrent Recipient" } },
  ]);
  const certificate = await db.transaction(tx => issueCertificateInTransaction(tx, owner, {
    requestId: randomUUID(), shareClass: "Common", quantity: 0.3,
    issueDate: "1946-01-01", vestingSchedule: "Legacy",
  }, "synthetic"));
  const results = await Promise.allSettled([0, 1].map(() => db.transaction(tx =>
    transferInTransaction(tx, owner, certificate.id, {
      requestId: randomUUID(), recipientId: recipient, quantity: 0.2, transferDate: "2026-01-01",
    }, "synthetic"))));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const row = (await db.select().from(certificatesTable).where(eq(certificatesTable.id, certificate.id)))[0];
  assert.equal(row.transferredQuantity, 0.2);
  assert.equal(remainingShares(row), 0.1);
});

test("PDF quantity field preserves two decimals for Common and Preferred", async () => {
  const template = await PDFDocument.create();
  const page = template.addPage();
  template.getForm().createTextField("quantity").addToPage(page);
  const bytes = await template.save();
  for (const shareClass of ["Common", "Preferred"] as const) {
    const rendered = await renderCertificatePdf(bytes, {
      certificateId: shareClass === "Common" ? "C-1" : "P-1", holderName: "Synthetic PDF Holder",
      shareClass, quantity: 12.34, issueDate: "1946-01-01", signers: [],
    });
    assert.ok(rendered.byteLength);
    const pdf = await PDFDocument.load(rendered);
    const content = pdf.context.enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFRawStream)
      .map(([, object]) => Buffer.from(decodePDFRawStream(object as PDFRawStream).decode()).toString("latin1"))
      .join("\n");
    assert.match(content, /31322e3334/i, "Flattened PDF appearance contains the exact 12.34 quantity.");
    await assert.rejects(renderCertificatePdf(bytes, { certificateId: "C-2", holderName: "Synthetic",
      shareClass, quantity: 12.345, issueDate: "1946-01-01", signers: [] }), /2 decimal/);
  }
});

test.after(async () => { await pool.end(); });
