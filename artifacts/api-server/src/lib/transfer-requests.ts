import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { activityTable, certificatesTable, shareholdersTable, shareTransfersTable, transferRequestsTable, signoffResultEmailNotificationsTable, type TransferRequestRow } from "@workspace/db";
import { change, recordActivity } from "./audit";
import { CertificateError, remainingShares, type Transaction } from "./certificates";
import { transferInTransaction, validateTransferInput, inputSources, lockTransferSources, type TransferInput } from "./transfers";
import { issueCertificateInTransaction } from "./certificates";
import { matchingSigners, requireConfiguredSigners, type ApprovalIdentity } from "./approval-policy";
import { enqueueSignoffEmails } from "./signoff-email-outbox";

export function presentRequest(row: TransferRequestRow, fallback: NonNullable<TransferRequestRow["requiredSigners"]> = [], identity?: ApprovalIdentity) {
  const { fingerprint: _fingerprint, requesterEmail: _requesterEmail, appOrigin: _appOrigin, ...record } = row;
  const signers = row.requiredSigners ?? (row.status === "Pending" ? fallback : []);
  const own = identity ? matchingSigners(signers, identity.emails) : [];
  return {
    ...record, sourceCertificateId: row.sourceCertificateId ?? "", requiredSigners: signers,
    canApprove: row.status === "Pending" && own.some(s => !row.approvals.some(a => a.id === s.id && a.email === s.email)),
    canReject: row.status === "Pending" && own.length > 0,
    legacyApprovals: Boolean(row.ceoApprovedAt || row.cfoApprovedAt),
    createdAt: row.createdAt.toISOString(),
    ceoApprovedAt: row.ceoApprovedAt?.toISOString() ?? null,
    cfoApprovedAt: row.cfoApprovedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
  };
}

export async function requestTransfer(tx: Transaction, originatorId: string, certificateId: string, input: TransferInput, actor: string, appOrigin?: string, requesterEmail?: string) {
  validateTransferInput(originatorId, input);
  const normalized: TransferInput = {
    requestId: input.requestId, quantity: input.quantity, transferDate: input.transferDate,
    reason: input.reason?.trim() ?? "", pricePerShare: input.pricePerShare,
    recipientId: input.recipientId,
    newRecipient: input.newRecipient ? { name: input.newRecipient.name.trim(), email: input.newRecipient.email?.trim() ?? "" } : undefined,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.sources ? { sources: inputSources(certificateId, input) } : {}),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ originatorId, certificateId, input: normalized })).digest("hex");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"transfer-request:" + input.requestId}, 0))`);
  const [replay] = await tx.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, input.requestId));
  if (replay) {
    if (replay.fingerprint !== fingerprint || replay.requestedBy !== actor) throw new CertificateError(409, "Request key already used. Start a new transfer request.");
    return replay;
  }
  // Legacy completed operations must never be replayed as new pending requests.
  const [legacy] = await tx.select().from(shareTransfersTable).where(eq(shareTransfersTable.requestId, input.requestId));
  if (legacy) throw new CertificateError(409, "This request key belongs to an already completed transfer.");
  const { source, allocations } = await lockTransferSources(tx, originatorId, certificateId, normalized);
  const [originator] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, originatorId));
  const [recipient] = input.recipientId ? await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, input.recipientId)) : [];
  if (!originator || (input.recipientId && !recipient)) throw new CertificateError(404, "Shareholder not found.");
  const signers = await requireConfiguredSigners(tx);
  const [row] = await tx.insert(transferRequestsTable).values({
    id: input.requestId, originatorId, originatorName: String(originator.data.name),
    recipientId: input.recipientId ?? null, recipientName: recipient ? String(recipient.data.name) : normalized.newRecipient!.name,
    sourceCertificateId: certificateId, shareClass: source.shareClass, vestingSchedule: source.vestingSchedule,
    input: normalized, fingerprint, requestedBy: actor, requiredSigners: signers,
    requesterEmail: requesterEmail ?? null, appOrigin: appOrigin ?? null,
  }).returning();
  await enqueueSignoffEmails(tx, row.id, signers, appOrigin);
  await recordActivity(tx, {
    shareholderId: originatorId, name: row.originatorName, actor,
    action: `Transfer requested · ${allocations.map(s => s.certificateId).join(", ")} · ${input.quantity} shares to ${row.recipientName} · awaiting configured signers`,
    changes: [change("Transfer request", null, row.id), change("Request status", null, "Pending"),
      ...allocations.map(s => change("Source certificate allocation", null, `${s.certificateId}: ${s.quantity} shares`)), change("Recipient", null, row.recipientName),
      change("Shares requested", null, input.quantity), change("Transfer date", null, input.transferDate),
      change("Transfer reason", null, input.reason || null), change("Price per share", null, input.pricePerShare ?? null),
      ...(input.attachments ?? []).map(d => change("Transfer attachment added", null, `${d.name} (${d.size} bytes)`))],
  });
  return row;
}

export async function decideRequest(tx: Transaction, id: string, actor: string, verifiedEmails: string[], decision: "approve" | "reject") {
  const [row] = await tx.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, id)).for("update");
  if (!row) throw new CertificateError(404, "Sign-off request not found.");
  // Old completed role-based requests remain immutable historical records.
  if (row.status !== "Pending" && row.requiredSigners === null) throw new CertificateError(409, `This historical request is ${row.status.toLowerCase()}.`);
  const signers = row.requiredSigners ?? await requireConfiguredSigners(tx);
  const own = matchingSigners(signers, verifiedEmails);
  if (!own.length) throw new CertificateError(403, "Your verified login email is not a required signer for this request.");
  const signed = (id: string, email: string) => row.approvals.some(a => a.id === id && a.email === email && a.userId === actor);
  if (row.status !== "Pending") {
    if ((row.status === "Completed" && decision === "approve" && own.every(s => signed(s.id, s.email))) ||
        (row.status === "Rejected" && decision === "reject" && row.rejectedBy === actor)) return row;
    throw new CertificateError(409, `This request is ${row.status.toLowerCase()}.`);
  }
  if (decision === "approve" && own.every(s => signed(s.id, s.email))) return row;
  const now = new Date();
  const votes = decision === "approve" ? [...row.approvals, ...own.filter(s => !row.approvals.some(a => a.id === s.id && a.email === s.email))
    .map(s => ({ ...s, userId: actor, approvedAt: now.toISOString() }))] : row.approvals;
  let updated: Partial<TransferRequestRow> = decision === "reject"
    ? { requiredSigners: signers, status: "Rejected", rejectedBy: actor, rejectedAt: now }
    : { requiredSigners: signers, approvals: votes };
  if (decision === "approve" && signers.every(s => votes.some(a => a.id === s.id && a.email === s.email))) {
    // The final approval and ledger mutation commit together. Failed execution
    // rolls back the last vote, all counter increments, and recipient creation.
    if (row.kind === "Issuance") {
      if (!row.issuance) throw new CertificateError(409, "Issuance details are missing.");
      const certificate = await issueCertificateInTransaction(tx, row.originatorId, row.issuance, actor);
      updated = { ...updated, status: "Completed", recipientCertificateId: certificate.id };
    } else {
      if (!row.sourceCertificateId) throw new CertificateError(409, "Source certificate is missing.");
      const transfer = await transferInTransaction(tx, row.originatorId, row.sourceCertificateId, row.input, actor);
      updated = { ...updated, status: "Completed", completedTransferId: transfer.id, recipientCertificateId: transfer.recipientCertificateId, recipientId: transfer.recipientId };
    }
  }
  const [result] = await tx.update(transferRequestsTable).set(updated).where(eq(transferRequestsTable.id, id)).returning();
  if (row.status === "Pending" && (result.status === "Completed" || result.status === "Rejected") && row.requesterEmail && row.appOrigin) {
    await tx.insert(signoffResultEmailNotificationsTable).values({
      id: randomUUID(), requestId: row.id, recipientEmail: row.requesterEmail,
      appOrigin: row.appOrigin, outcome: result.status === "Completed" ? "Approved" : "Rejected",
    }).onConflictDoNothing({ target: signoffResultEmailNotificationsTable.requestId });
  }
  await recordActivity(tx, {
    shareholderId: row.originatorId, name: row.originatorName, actor,
    action: `${own.map(s => s.name).join(", ")} ${decision === "approve" ? "approved" : "rejected"} ${row.kind.toLowerCase()} request ${id}${result.status === "Completed" ? " · completed" : ""}`,
    changes: [change("Sign-off request", null, id),
      change("Configured signatory decision", null, decision === "approve" ? "Approved" : "Rejected"),
      ...(row.requiredSigners === null ? [change("Approval policy", "Legacy role-based sign-offs", "Settings signers; previous approvals retained for reference")] : []),
      ...(result.status !== row.status ? [change("Request status", row.status, result.status)] : [])],
  });
  return result;
}
