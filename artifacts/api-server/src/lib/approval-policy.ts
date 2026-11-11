import { asc } from "drizzle-orm";
import { signoffsTable, type ApprovalSigner, type TransferRequestRow } from "@workspace/db";
import { CertificateError, type Transaction } from "./certificates";

export type ApprovalIdentity = { id: string; emails: string[] };
export async function configuredSigners(tx: Pick<Transaction, "select">): Promise<ApprovalSigner[]> {
  return (await tx.select().from(signoffsTable).orderBy(asc(signoffsTable.id)))
    .map(s => ({ id: s.id, name: s.name, email: s.email.trim().toLowerCase(), signaturePath: s.signaturePath,
      emailNotificationsEnabled: s.emailNotificationsEnabled }));
}
export async function requireConfiguredSigners(tx: Transaction) {
  const signers = await configuredSigners(tx);
  if (!signers.length) throw new CertificateError(409, "Add at least one signatory in Settings → Sign Offs before submitting a request.");
  return signers;
}
export function matchingSigners(signers: ApprovalSigner[], emails: string[]) {
  const verified = new Set(emails.map(e => e.trim().toLowerCase()));
  return signers.filter(s => verified.has(s.email.toLowerCase()));
}
export function awaitingSigner(row: TransferRequestRow, identity: ApprovalIdentity, fallback: ApprovalSigner[] = []) {
  return row.status === "Pending" && matchingSigners(row.requiredSigners ?? fallback, identity.emails)
    .some(s => !row.approvals.some(a => a.id === s.id && a.email === s.email));
}
