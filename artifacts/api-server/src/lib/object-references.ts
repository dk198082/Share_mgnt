import { db, uploadsTable, certificateTemplatesTable, certificateDocumentsTable, signoffsTable,
  shareholdersTable, transferRequestsTable, shareTransfersTable } from "@workspace/db";

/** All durable paths, including snapshots in approval/transaction history and pending upload registrations. */
export async function collectObjectPaths(): Promise<string[]> {
  const paths = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && value) paths.add(value); };
  const attachments = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) if (item && typeof item === "object") add(item.objectPath);
  };
  for (const row of await db.select({ path: uploadsTable.objectPath }).from(uploadsTable)) add(row.path);
  for (const row of await db.select({ path: certificateTemplatesTable.objectPath }).from(certificateTemplatesTable)) add(row.path);
  for (const row of await db.select({ path: certificateDocumentsTable.objectPath }).from(certificateDocumentsTable)) add(row.path);
  for (const row of await db.select({ path: signoffsTable.signaturePath }).from(signoffsTable)) add(row.path);
  for (const row of await db.select({ data: shareholdersTable.data }).from(shareholdersTable)) {
    add(row.data.picturePath); attachments(row.data.documents);
  }
  for (const row of await db.select({ input: transferRequestsTable.input, signers: transferRequestsTable.requiredSigners,
    approvals: transferRequestsTable.approvals }).from(transferRequestsTable)) {
    attachments(row.input.attachments);
    for (const signer of row.signers ?? []) add(signer.signaturePath);
    for (const signer of row.approvals) add(signer.signaturePath);
  }
  for (const row of await db.select({ attachments: shareTransfersTable.attachments }).from(shareTransfersTable)) attachments(row.attachments);
  return [...paths].sort();
}
