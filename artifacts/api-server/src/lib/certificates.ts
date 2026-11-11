import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, activityTable, certificatesTable, certificateCountersTable, shareholdersTable, type CertificateRow } from "@workspace/db";
import { change, recordActivity } from "./audit";

export type CertificateIssueInput = {
  requestId: string;
  shareClass: "Common" | "Preferred";
  quantity: number;
  issueDate: string;
  vestingSchedule: string;
};
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class CertificateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Counter allocation, certificate creation and activity recording commit together.
// A failed issuance rolls back its number; successful numbers are never reused.
export async function issueCertificateInTransaction(tx: Transaction, shareholderId: string, input: CertificateIssueInput, actor: string) {
  // Serializes retries of the same operation, even if payload/class was changed.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
  const [existing] = await tx.select().from(certificatesTable).where(eq(certificatesTable.requestId, input.requestId));
  if (existing) {
    if (existing.shareholderId !== shareholderId || existing.shareClass !== input.shareClass ||
        existing.quantity !== input.quantity || existing.issueDate !== input.issueDate ||
        existing.vestingSchedule !== input.vestingSchedule) {
      throw new CertificateError(409, "This request was already used with different details. Start a new certificate.");
    }
    return existing;
  }
  const [shareholder] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, shareholderId)).for("update");
  if (!shareholder) throw new CertificateError(404, "Shareholder not found.");
  const [counter] = await tx.insert(certificateCountersTable).values({ shareClass: input.shareClass, lastNumber: 1 })
    .onConflictDoUpdate({
      target: certificateCountersTable.shareClass,
      set: { lastNumber: sql`${certificateCountersTable.lastNumber} + 1` },
    }).returning();
  const id = `${input.shareClass === "Common" ? "C" : "P"}-${counter.lastNumber}`;
  const [certificate] = await tx.insert(certificatesTable).values({
    id, sequenceNumber: counter.lastNumber, shareholderId, ...input, issuedBy: actor,
  }).returning();
  await tx.update(shareholdersTable).set({ updatedAt: new Date() }).where(eq(shareholdersTable.id, shareholderId));
  await recordActivity(tx, {
    shareholderId, name: String(shareholder.data.name ?? ""),
    action: `Certificate ${id} issued · ${input.quantity} ${input.shareClass} shares`, actor,
    changes: [
      change("Certificate", null, id), change("Share class", null, input.shareClass),
      change("Shares issued", null, input.quantity), change("Issue date", null, input.issueDate),
      change("Vesting schedule", null, input.vestingSchedule), change("Certificate status", null, "Outstanding"),
    ],
  });
  return certificate;
}

export function remainingShares(row: CertificateRow) {
  return ["Outstanding", "Partially Transferred"].includes(row.status) ? row.quantity - row.transferredQuantity : 0;
}
export function presentCertificate(row: CertificateRow, companyShares: number) {
  const fullyDiluted = remainingShares(row);
  return {
    id: row.id, shareholderId: row.shareholderId, shareClass: row.shareClass,
    quantity: row.quantity, remainingQuantity: fullyDiluted, transferredQuantity: row.transferredQuantity, issueDate: row.issueDate, status: row.status,
    vestingSchedule: row.vestingSchedule, fullyDiluted,
    percentFullyDiluted: companyShares > 0 ? fullyDiluted / companyShares * 100 : 0,
    createdAt: row.createdAt.toISOString(),
  };
}
export function outstandingTotal(rows: CertificateRow[]) {
  return rows.reduce((sum, r) => sum + remainingShares(r), 0);
}
