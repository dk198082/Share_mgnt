import { eq, max } from "drizzle-orm";
import {
  db, certificateCountersTable, certificatesTable,
} from "@workspace/db";
import type { CertificateCounterState } from "@workspace/api-zod";
import { auditContext, change } from "./audit";
import { CertificateError, type Transaction } from "./certificates";
import { recordSettingsChange } from "./settings-audit";

export const CERTIFICATE_SHARE_CLASSES = ["Common", "Preferred"] as const;
export type CertificateShareClass = typeof CERTIFICATE_SHARE_CLASSES[number];

type Reader = Pick<Transaction, "select">;

export async function readCertificateCounters(reader: Reader = db): Promise<CertificateCounterState[]> {
  const counters: (typeof certificateCountersTable.$inferSelect)[] = await reader.select().from(certificateCountersTable);
  const issued = await reader.select({
    shareClass: certificatesTable.shareClass,
    lastIssuedNumber: max(certificatesTable.sequenceNumber),
  }).from(certificatesTable).groupBy(certificatesTable.shareClass);
  const counterByClass = new Map(counters.map(counter => [counter.shareClass, counter.lastNumber]));
  const issuedByClass = new Map(issued.map(row => [row.shareClass, row.lastIssuedNumber ?? 0]));
  return CERTIFICATE_SHARE_CLASSES.map(shareClass => {
    const lastIssuedNumber = issuedByClass.get(shareClass) ?? 0;
    const counterLastNumber = counterByClass.get(shareClass) ?? 0;
    return {
      shareClass,
      lastIssuedNumber,
      nextNumber: Math.max(lastIssuedNumber, counterLastNumber) + 1,
    };
  });
}

export async function advanceCertificateCounter(
  tx: Transaction,
  shareClass: CertificateShareClass,
  nextNumber: number,
  reason: string,
): Promise<void> {
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > 2_147_483_647) {
    throw new CertificateError(400, "Enter a whole next certificate number within the supported range.");
  }
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 2000) {
    throw new CertificateError(400, "A reason of up to 2,000 characters is required.");
  }

  // Ensure a row exists, then lock it so issuance and counter changes serialize.
  // Issuance allocates by upserting this same class key.
  await tx.insert(certificateCountersTable).values({ shareClass, lastNumber: 0 }).onConflictDoNothing();
  const [counter] = await tx.select().from(certificateCountersTable)
    .where(eq(certificateCountersTable.shareClass, shareClass)).for("update");
  if (!counter) throw new Error("Certificate counter could not be locked.");

  const [issued] = await tx.select({
    lastIssuedNumber: max(certificatesTable.sequenceNumber),
  }).from(certificatesTable).where(eq(certificatesTable.shareClass, shareClass));
  const lastIssuedNumber = issued?.lastIssuedNumber ?? 0;
  const currentNextNumber = Math.max(counter.lastNumber, lastIssuedNumber) + 1;
  if (nextNumber <= currentNextNumber) {
    throw new CertificateError(409, `The next ${shareClass} number must be higher than the current next number (${currentNextNumber}). Certificate sequences cannot be rolled back.`);
  }

  await tx.update(certificateCountersTable)
    .set({ lastNumber: nextNumber - 1 })
    .where(eq(certificateCountersTable.shareClass, shareClass));
  const actor = auditContext.getStore();
  if (!actor) throw new Error("Certificate counter changes require an authenticated employee identity.");
  await recordSettingsChange(tx, {
    action: "Certificate sequence advanced",
    targetId: `certificate-counter:${shareClass}`,
    changes: [
      change(`Next ${shareClass} certificate number`, currentNextNumber, nextNumber),
      change("Reason", null, normalizedReason),
    ],
  });
}
