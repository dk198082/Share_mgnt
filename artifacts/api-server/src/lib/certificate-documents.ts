import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db, certificateTemplatesTable, certificateRequestTemplatesTable, certificateDocumentsTable,
  shareholdersTable, certificatesTable, type TransferRequestRow,
} from "@workspace/db";
import { CertificateError, type Transaction } from "./certificates";
import { ObjectStorageService } from "./objectStorage";
import { renderCertificatePdf, validateCertificateTemplate } from "./certificate-pdf";
import type { CertificatePdfInput } from "./certificate-pdf";
import { change, recordActivity } from "./audit";

const storage = new ObjectStorageService();
export async function storePrivatePdf(folder: string, bytes: Uint8Array): Promise<string> {
  const id = randomUUID();
  const objectPath = `/objects/${folder}/${id}`;
  await storage.putPrivateObject(objectPath, bytes, "application/pdf");
  return objectPath;
}
export async function readPrivateBytes(path: string): Promise<Buffer> {
  const file = await storage.getObjectEntityFile(path);
  const [meta] = await file.getMetadata();
  if (Number(meta.size) > 10 * 1024 * 1024) throw new CertificateError(400, "File exceeds 10 MB.");
  return (await file.download())[0];
}
export async function installCertificateTemplate(bytes: Uint8Array, shareClass: "Common" | "Preferred", name: string, actor: string) {
  const fields = await validateCertificateTemplate(bytes);
  const objectPath = await storePrivatePdf("certificate-templates", bytes);
  return db.transaction(async tx => {
    await tx.execute(sqlTemplateLock(shareClass));
    await tx.update(certificateTemplatesTable).set({ active: false }).where(eq(certificateTemplatesTable.shareClass, shareClass));
    const [row] = await tx.insert(certificateTemplatesTable).values({
      id: randomUUID(), shareClass, name, objectPath, fields, createdBy: actor,
    }).returning();
    return row;
  });
}
const sqlTemplateLock = (shareClass: string) => sql`SELECT pg_advisory_xact_lock(hashtextextended(${"certificate-template:" + shareClass}, 0))`;

export async function captureCertificateTemplate(tx: Transaction, request: TransferRequestRow) {
  const [existing] = await tx.select().from(certificateRequestTemplatesTable).where(eq(certificateRequestTemplatesTable.requestId, request.id));
  if (existing || request.status !== "Pending") return;
  const [template] = await tx.select().from(certificateTemplatesTable)
    .where(and(eq(certificateTemplatesTable.shareClass, request.shareClass), eq(certificateTemplatesTable.active, true)));
  if (!template) throw new CertificateError(409, `An administrator must upload a ${request.shareClass} certificate template in Settings before submitting this request.`);
  await tx.insert(certificateRequestTemplatesTable).values({ requestId: request.id, templateId: template.id });
}

/** Runs in the final approval transaction. A PDF failure rolls back the final vote and ledger mutation. */
export type CertificatePdfIO = {
  read: (path: string) => Promise<Uint8Array>;
  write: (folder: string, bytes: Uint8Array) => Promise<string>;
  render: (template: Uint8Array, input: CertificatePdfInput) => Promise<Uint8Array>;
};
const defaultIO: CertificatePdfIO = { read: readPrivateBytes, write: storePrivatePdf, render: renderCertificatePdf };
export async function retainCompletedCertificate(tx: Transaction, request: TransferRequestRow, io: CertificatePdfIO = defaultIO) {
  if (request.status !== "Completed" || !request.recipientCertificateId) return;
  const [existing] = await tx.select().from(certificateDocumentsTable).where(eq(certificateDocumentsTable.requestId, request.id));
  if (existing) return;
  const [snapshot] = await tx.select().from(certificateRequestTemplatesTable).where(eq(certificateRequestTemplatesTable.requestId, request.id));
  // Historic requests are not fabricated or regenerated from today's template/holder details.
  if (!snapshot) return;
  const [template] = await tx.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, snapshot.templateId));
  const [certificate] = await tx.select().from(certificatesTable).where(eq(certificatesTable.id, request.recipientCertificateId));
  if (!template || !certificate) throw new CertificateError(409, "Certificate template or completed certificate is unavailable.");
  const [holder] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, certificate.shareholderId));
  if (!holder) throw new CertificateError(409, "Certificate holder is unavailable.");
  try {
    const signers = await Promise.all(request.approvals.map(async signer => ({
      name: signer.name, image: await io.read(signer.signaturePath),
    })));
    const bytes = await io.render(await io.read(template.objectPath), {
      certificateId: certificate.id, holderName: String(holder.data.name), quantity: certificate.quantity,
      issueDate: certificate.issueDate!, shareClass: certificate.shareClass, signers,
    });
    const objectPath = await io.write("certificate-pdfs", bytes);
    await tx.insert(certificateDocumentsTable).values({
      id: randomUUID(), certificateId: certificate.id, requestId: request.id, templateId: template.id,
      shareholderId: certificate.shareholderId, originatorId: request.kind === "Transfer" ? request.originatorId : null,
      transferId: request.completedTransferId, objectPath,
    });
    for (const shareholderId of new Set([certificate.shareholderId, ...(request.kind === "Transfer" ? [request.originatorId] : [])])) {
      await recordActivity(tx, { shareholderId, name: shareholderId === certificate.shareholderId ? String(holder.data.name) : request.originatorName,
        actor: request.approvals.at(-1)?.userId ?? certificate.issuedBy, action: `Certificate PDF ${certificate.id} retained`,
        changes: [change("Certificate PDF", null, certificate.id), change("Certificate template version", null, template.id)] });
    }
  } catch (error) {
    if (error instanceof CertificateError) throw error;
    throw new CertificateError(503, "The certificate PDF could not be generated or retained. No final approval or share changes were saved. Check the template and signature files, then retry.");
  }
}
