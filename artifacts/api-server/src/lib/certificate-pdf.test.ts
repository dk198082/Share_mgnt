import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { db, pool, shareholdersTable, certificatesTable, certificateCountersTable, transferRequestsTable,
  signoffsTable, certificateTemplatesTable, certificateDocumentsTable, activityTable } from "@workspace/db";
import { validateCertificateTemplate, renderCertificatePdf } from "./certificate-pdf";
import { captureCertificateTemplate, retainCompletedCertificate, type CertificatePdfIO } from "./certificate-documents";
import { requestIssuance } from "./issuance-requests";
import { requestTransfer, decideRequest } from "./transfer-requests";
import { issueCertificateInTransaction, type Transaction } from "./certificates";

async function blank() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([792, 612]);
  for (const [i, name] of ["certificateId", "holderName", "quantity", "issueDate", "signature1", "signer1Name"].entries())
    pdf.getForm().createTextField(name).addToPage(page, { x: 40, y: 500 - i * 60, width: 600, height: 35 });
  return pdf.save();
}
const signature = () => sharp({ create: { width: 120, height: 35, channels: 4, background: "#234b50" } }).png().toBuffer();

test("blank templates are validated; generated PDFs flatten fields and preserve every signer", async () => {
  const template = await blank();
  assert.ok((await validateCertificateTemplate(template)).includes("certificateId"));
  await assert.rejects(validateCertificateTemplate(Buffer.from("not a pdf")), /Upload a PDF/);
  const filled = await PDFDocument.load(template);
  filled.getForm().getTextField("holderName").setText("Not blank");
  await assert.rejects(validateCertificateTemplate(await filled.save()), /blank PDF/);
  const image = await signature();
  for (const shareClass of ["Common", "Preferred"] as const) {
    const result = await renderCertificatePdf(template, {
      certificateId: shareClass === "Common" ? "C-901" : "P-902", holderName: "Verification Holder",
      quantity: 12, issueDate: "2026-01-02", shareClass,
      signers: [{ name: "First verification signer", image }, { name: "Additional verification signer", image }],
    });
    const final = await PDFDocument.load(result);
    assert.equal(final.getForm().getFields().length, 0);
    assert.equal(final.getPageCount(), 2, "overflow signer must receive an appendix");
  }
});

test("certificate PDF retention is atomic, versioned, replay-safe and visible to both transfer parties", async t => {
  const schema = `certificate_pdf_checks_${randomUUID().replaceAll("-", "")}`;
  const tx = <T,>(fn: (transaction: Transaction) => Promise<T>) => db.transaction(async transaction => {
    await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
    return fn(transaction);
  });
  const template = await blank(), image = await signature();
  let writes = 0;
  const reads: string[] = [];
  const io: CertificatePdfIO = {
    read: async path => { reads.push(path); return path.includes("signature") ? image : template; },
    write: async () => `/objects/certificate-pdfs/verification-${++writes}`,
    render: renderCertificatePdf,
  };
  const input = () => ({ requestId: randomUUID(), quantity: 4, shareClass: "Preferred" as const, issueDate: "2026-01-02", vestingSchedule: "Fully vested upon grant" });
  const approve = (id: string, deps = io) => tx(async transaction => {
    const request = await decideRequest(transaction, id, "verification-admin", ["verification@example.test"], "approve");
    await retainCompletedCertificate(transaction, request, deps);
    return request;
  });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["shareholders", "certificates", "certificate_counters", "shareholder_activity", "share_transfers", "transfer_requests", "signoffs", "certificate_templates", "certificate_request_templates", "certificate_documents"])
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await tx(async transaction => {
      await transaction.insert(shareholdersTable).values([{ id: "origin", data: { name: "Verification Owner" } }, { id: "recipient", data: { name: "Verification Recipient" } }]);
      await transaction.insert(signoffsTable).values({ id: "verification-signer", name: "Verification Signer", email: "verification@example.test", signaturePath: "/objects/signature", updatedBy: "verification-admin" });
      await transaction.insert(certificateTemplatesTable).values(["Common", "Preferred"].map(shareClass => ({
        id: shareClass, shareClass: shareClass as "Common" | "Preferred", name: "Verification blank", objectPath: `/objects/template-${shareClass}`, fields: [], createdBy: "verification-admin",
      })));
      await issueCertificateInTransaction(transaction, "origin", { ...input(), shareClass: "Common", quantity: 10 }, "verification-admin");
    });
    await t.test("template is captured before replacement and completion archives exactly one PDF", async () => {
      const request = await tx(async transaction => {
        const row = await requestIssuance(transaction, "recipient", input(), "verification-admin");
        await captureCertificateTemplate(transaction, row); return row;
      });
      await tx(async transaction => {
        await transaction.update(certificateTemplatesTable).set({ active: false }).where(eq(certificateTemplatesTable.id, "Preferred"));
        await transaction.insert(certificateTemplatesTable).values({ id: "Preferred-new", shareClass: "Preferred", name: "Replacement", objectPath: "/objects/template-new", fields: [], createdBy: "verification-admin" });
      });
      const completed = await approve(request.id);
      assert.equal(completed.status, "Completed");
      const [document] = await tx(transaction => transaction.select().from(certificateDocumentsTable).where(eq(certificateDocumentsTable.requestId, request.id)));
      assert.equal(document.templateId, "Preferred");
      assert.ok(reads.includes("/objects/template-Preferred"));
      const before = writes;
      await approve(request.id);
      assert.equal(writes, before, "repeated approval must not write another PDF");
    });
    await t.test("storage failure rolls back the final signature, ledger, counter and history", async () => {
      const request = await tx(async transaction => {
        const row = await requestIssuance(transaction, "recipient", input(), "verification-admin");
        await captureCertificateTemplate(transaction, row); return row;
      });
      const counters = await tx(transaction => transaction.select().from(certificateCountersTable));
      const certificates = await tx(transaction => transaction.select().from(certificatesTable));
      const history = await tx(transaction => transaction.select().from(activityTable));
      await assert.rejects(approve(request.id, { ...io, write: async () => { throw new Error("simulated storage outage"); } }), /No final approval or share changes/);
      const [row] = await tx(transaction => transaction.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, request.id)));
      assert.equal(row.status, "Pending"); assert.equal(row.approvals.length, 0);
      assert.deepEqual(await tx(transaction => transaction.select().from(certificateCountersTable)), counters);
      assert.deepEqual(await tx(transaction => transaction.select().from(certificatesTable)), certificates);
      assert.deepEqual(await tx(transaction => transaction.select().from(activityTable)), history);
    });
    await t.test("transfer PDF links the new certificate, completed transaction and both shareholders", async () => {
      const request = await tx(async transaction => {
        const row = await requestTransfer(transaction, "origin", "C-1", {
          requestId: randomUUID(), recipientId: "recipient", quantity: 3, transferDate: "2026-01-03",
        }, "verification-admin");
        await captureCertificateTemplate(transaction, row); return row;
      });
      const completed = await approve(request.id);
      const [document] = await tx(transaction => transaction.select().from(certificateDocumentsTable).where(eq(certificateDocumentsTable.requestId, request.id)));
      assert.equal(document.originatorId, "origin"); assert.equal(document.shareholderId, "recipient");
      assert.equal(document.transferId, completed.completedTransferId);
      assert.equal(document.certificateId, completed.recipientCertificateId);
      const history = await tx(transaction => transaction.select().from(activityTable));
      assert.equal(history.filter(e => e.action === `Certificate PDF ${document.certificateId} retained`).length, 2);
    });
    await t.test("batch completion retains one consolidated PDF, not one per source", async () => {
      const request = await tx(async transaction => {
        const extra = await issueCertificateInTransaction(transaction, "origin", { ...input(), shareClass: "Common", quantity: 5 }, "verification-admin");
        const row = await requestTransfer(transaction, "origin", "C-1", {
          requestId: randomUUID(), recipientId: "recipient", quantity: 7, transferDate: "2026-01-03",
          sources: [{ certificateId: "C-1", quantity: 2 }, { certificateId: extra.id, quantity: 5 }],
        }, "verification-admin");
        await captureCertificateTemplate(transaction, row); return row;
      });
      const before = writes;
      await assert.rejects(approve(request.id, { ...io, write: async () => { throw new Error("batch storage outage"); } }), /No final approval or share changes/);
      const [pending] = await tx(transaction => transaction.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, request.id)));
      assert.equal(pending.status, "Pending");
      assert.equal(pending.approvals.length, 0);
      const completed = await approve(request.id);
      assert.equal(writes, before + 1);
      const documents = await tx(transaction => transaction.select().from(certificateDocumentsTable).where(eq(certificateDocumentsTable.requestId, request.id)));
      assert.equal(documents.length, 1);
      assert.equal(documents[0].transferId, completed.completedTransferId);
      assert.equal(documents[0].certificateId, completed.recipientCertificateId);
      const [certificate] = await tx(transaction => transaction.select().from(certificatesTable).where(eq(certificatesTable.id, completed.recipientCertificateId!)));
      assert.equal(certificate.quantity, 7);
      await approve(request.id);
      assert.equal(writes, before + 1);
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end();
  }
});
