import { randomUUID } from "node:crypto";
import { signoffEmailNotificationsTable } from "@workspace/db";
import type { Transaction } from "./certificates";

export async function enqueueSignoffEmails(
  tx: Transaction, requestId: string, signers: Array<{ id: string; email: string; emailNotificationsEnabled?: boolean }>, appOrigin: string | undefined,
): Promise<void> {
  const notified = signers.filter(signer => signer.emailNotificationsEnabled !== false);
  if (!appOrigin || notified.length === 0) return;
  await tx.insert(signoffEmailNotificationsTable).values(notified.map(signer => ({
    id: randomUUID(), requestId, signerId: signer.id, recipientEmail: signer.email, appOrigin,
  }))).onConflictDoNothing({
    target: [signoffEmailNotificationsTable.requestId, signoffEmailNotificationsTable.signerId],
  });
}

