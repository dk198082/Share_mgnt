import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { certificatesTable, shareholdersTable, transferRequestsTable } from "@workspace/db";
import { CertificateError, type CertificateIssueInput, type Transaction } from "./certificates";
import { requireConfiguredSigners } from "./approval-policy";
import { change, recordActivity } from "./audit";
import { enqueueSignoffEmails } from "./signoff-email-outbox";

export async function requestIssuance(tx: Transaction, shareholderId: string, input: CertificateIssueInput, actor: string, appOrigin?: string, requesterEmail?: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"transfer-request:" + input.requestId}, 0))`);
  const fingerprint = createHash("sha256").update(JSON.stringify({ kind: "Issuance", shareholderId, input })).digest("hex");
  const [existing] = await tx.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, input.requestId));
  if (existing) {
    if (existing.fingerprint !== fingerprint || existing.requestedBy !== actor) throw new CertificateError(409, "Request key already used with different details.");
    return existing;
  }
  const [certificate] = await tx.select().from(certificatesTable).where(eq(certificatesTable.requestId, input.requestId));
  if (certificate) throw new CertificateError(409, `This operation already issued ${certificate.id}. Refresh the ledger instead of submitting it again.`);
  const [holder] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, shareholderId));
  if (!holder) throw new CertificateError(404, "Shareholder not found.");
  const requiredSigners = await requireConfiguredSigners(tx);
  const name = String(holder.data.name);
  const [row] = await tx.insert(transferRequestsTable).values({
    id: input.requestId, kind: "Issuance", originatorId: shareholderId, originatorName: name,
    recipientId: shareholderId, recipientName: name, sourceCertificateId: null,
    shareClass: input.shareClass, vestingSchedule: input.vestingSchedule, issuance: input,
    input: { requestId: input.requestId, recipientId: shareholderId, quantity: input.quantity, transferDate: input.issueDate },
    fingerprint, requestedBy: actor, requiredSigners, requesterEmail: requesterEmail ?? null, appOrigin: appOrigin ?? null,
  }).returning();
  await enqueueSignoffEmails(tx, row.id, requiredSigners, appOrigin);
  await recordActivity(tx, { shareholderId, name, actor, action: `Certificate issuance requested · ${input.quantity} ${input.shareClass} shares · awaiting configured signers`,
    changes: [change("Sign-off request", null, row.id), change("Request status", null, "Pending"),
      change("Shares requested", null, input.quantity), change("Share class", null, input.shareClass), change("Issue date", null, input.issueDate)] });
  return row;
}
