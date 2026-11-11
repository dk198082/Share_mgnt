import { eq } from "drizzle-orm";
import { uploadsTable, shareTransfersTable, transferRequestsTable } from "@workspace/db";
import { CertificateError, type Transaction } from "./certificates";
import { ObjectStorageService } from "./objectStorage";
import { recordActivity, change } from "./audit";
import { db } from "@workspace/db";

export type TransferDocument = { name: string; objectPath: string; size: number };
const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
export async function validateTransferDocuments(documents: TransferDocument[]) {
  if (documents.length > 20) throw new CertificateError(400, "A transfer can have at most 20 files.");
  const storage = new ObjectStorageService();
  await Promise.all(documents.map(async doc => {
    if (!doc.name.trim() || !Number.isSafeInteger(doc.size) || doc.size < 1 || doc.size > 10485760) {
      throw new CertificateError(400, "Each file must have a name and be between 1 byte and 10 MB.");
    }
    const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, doc.objectPath));
    if (!upload || upload.purpose !== "profile" || !allowedTypes.includes(upload.contentType)) {
      throw new CertificateError(400, "Choose a registered PDF, image or text upload; private signature images cannot be transfer attachments.");
    }
    try {
      const file = await storage.getObjectEntityFile(doc.objectPath);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) !== doc.size || metadata.contentType !== upload.contentType) throw new Error("Invalid metadata");
    } catch { throw new CertificateError(400, "A file is incomplete or its size/type does not match the upload. Upload it again."); }
  }));
}
export function mergeTransferDocuments(existing: TransferDocument[], incoming: TransferDocument[]) {
  const all = [...existing], added: TransferDocument[] = [];
  for (const doc of incoming) {
    const old = all.find(d => d.objectPath === doc.objectPath);
    if (old) {
      if (old.name !== doc.name || old.size !== doc.size) throw new CertificateError(409, "Existing attachment details cannot be changed.");
      continue;
    }
    all.push(doc); added.push(doc);
  }
  if (all.length > 20) throw new CertificateError(400, "A transfer can have at most 20 files.");
  return { all, added };
}
const fileChanges = (files: TransferDocument[]) => files.map(d => change("Transfer attachment added", null, `${d.name} (${d.size} bytes)`));
export async function appendTransferDocuments(tx: Transaction, id: string, docs: TransferDocument[], actor: string) {
  const [row] = await tx.select().from(shareTransfersTable).where(eq(shareTransfersTable.id, id)).for("update");
  if (!row) throw new CertificateError(404, "Transfer not found.");
  const { all, added } = mergeTransferDocuments(row.attachments, docs);
  if (!added.length) return row;
  const [saved] = await tx.update(shareTransfersTable).set({ attachments: all }).where(eq(shareTransfersTable.id, id)).returning();
  for (const [shareholderId, name] of [[row.originatorId, row.originatorName], [row.recipientId, row.recipientName]]) {
    await recordActivity(tx, { shareholderId, name, actor, action: `Supporting files added to transfer ${row.sourceCertificateId} → ${row.recipientCertificateId}`,
      changes: fileChanges(added) });
  }
  return saved;
}
export async function appendRequestDocuments(tx: Transaction, id: string, docs: TransferDocument[], actor: string, role: string | null) {
  const [row] = await tx.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, id)).for("update");
  if (!row) throw new CertificateError(404, "Transfer request not found.");
  if (row.kind !== "Transfer") throw new CertificateError(400, "Attachments are supported on transfer requests only.");
  if (row.requestedBy !== actor && role !== "admin" && role !== "pilot") throw new CertificateError(403, "Only an authorized pilot participant can attach request files.");
  if (row.status !== "Pending" || row.approvals.length || row.ceoApprovedBy || row.cfoApprovedBy) {
    throw new CertificateError(409, "Request attachments are locked after the first sign-off. Completed transfers accept separate supporting documents.");
  }
  const { all, added } = mergeTransferDocuments(row.input.attachments ?? [], docs);
  if (!added.length) return row;
  // Retain the creation fingerprint: replaying creation returns the same request
  // without discarding files appended since it was first submitted.
  const [saved] = await tx.update(transferRequestsTable).set({ input: { ...row.input, attachments: all } })
    .where(eq(transferRequestsTable.id, id)).returning();
  await recordActivity(tx, { shareholderId: row.originatorId, name: row.originatorName, actor,
    action: `Files added to pending transfer request ${row.sourceCertificateId}`, changes: fileChanges(added) });
  return saved;
}
