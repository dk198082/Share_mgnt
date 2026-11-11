import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { activityTable, certificatesTable, shareholdersTable, shareTransfersTable, type ShareTransferRow } from "@workspace/db";
import { CertificateError, issueCertificateInTransaction, remainingShares, type Transaction } from "./certificates";
import { change, profileChanges, recordActivity } from "./audit";

export type TransferInput = {
  sources?: { certificateId: string; quantity: number }[];
  attachments?: { name: string; objectPath: string; size: number }[];
  recipientId?: string;
  newRecipient?: { name: string; email?: string };
  quantity: number;
  transferDate: string;
  reason?: string;
  pricePerShare?: string;
  requestId: string;
};
export function transferSources(row: { sourceCertificateId: string; quantity: number; sources?: { certificateId: string; quantity: number }[] | null }) {
  return row.sources?.length ? row.sources : [{ certificateId: row.sourceCertificateId, quantity: row.quantity }];
}
export function inputSources(certificateId: string, input: TransferInput) {
  const sources = input.sources ?? [{ certificateId, quantity: input.quantity }];
  if (!sources.length || sources.length > 100 ||
      new Set(sources.map(s => s.certificateId)).size !== sources.length ||
      !sources.some(s => s.certificateId === certificateId) ||
      sources.some(s => !s.certificateId || !Number.isSafeInteger(s.quantity) || s.quantity <= 0 || s.quantity > 1e12) ||
      sources.reduce((n, s) => n + s.quantity, 0) !== input.quantity) {
    throw new CertificateError(400, "Select up to 100 distinct source certificates with positive whole quantities adding up to the transfer total.");
  }
  // Rebuild keys as well as sorting rows: JSONB can reorder object properties.
  // Approval execution and retries must hash the same allocation payload.
  return sources.map(s => ({ certificateId: s.certificateId, quantity: s.quantity }))
    .sort((a, b) => a.certificateId.localeCompare(b.certificateId));
}
export async function lockTransferSources(tx: Transaction, originatorId: string, certificateId: string, input: TransferInput) {
  const allocations = inputSources(certificateId, input);
  const rows = await tx.select().from(certificatesTable)
    .where(inArray(certificatesTable.id, allocations.map(s => s.certificateId))).orderBy(certificatesTable.id).for("update");
  const source = rows.find(c => c.id === certificateId);
  if (!source || rows.length !== allocations.length || rows.some(c => c.shareholderId !== originatorId))
    throw new CertificateError(404, "Every source certificate must belong to the same source shareholder.");
  for (const row of rows) {
    const allocation = allocations.find(s => s.certificateId === row.id)!;
    if (row.shareClass !== source.shareClass) throw new CertificateError(400, "Common and Preferred certificates cannot be combined in one transfer.");
    if (row.vestingSchedule !== source.vestingSchedule) throw new CertificateError(400, "Source certificates must have the same vesting schedule to consolidate without changing their terms.");
    if (allocation.quantity > remainingShares(row)) throw new CertificateError(409, `Only ${remainingShares(row)} shares remain on ${row.id}. Refresh and review the batch.`);
    if (row.issueDate && input.transferDate < row.issueDate) throw new CertificateError(400, `Transfer date cannot precede the issue date of ${row.id}.`);
    const [incoming] = await tx.select().from(shareTransfersTable).where(eq(shareTransfersTable.recipientCertificateId, row.id));
    if (incoming && input.transferDate < incoming.transferDate) throw new CertificateError(400, `Transfer date cannot precede receipt of ${row.id}.`);
  }
  return { source, rows, allocations };
}
export function presentTransfer(row: ShareTransferRow) {
  const { requestId: _key, requestFingerprint: _fingerprint, recordedBy: _actor, ...record } = row;
  return { ...record, createdAt: row.createdAt.toISOString() };
}
export function validateTransferInput(originatorId: string, input: TransferInput) {
  if (Boolean(input.recipientId) === Boolean(input.newRecipient)) throw new CertificateError(400, "Choose an existing recipient or add a new recipient, not both.");
  if (input.recipientId === originatorId) throw new CertificateError(400, "The recipient must be a different shareholder.");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 1e12) throw new CertificateError(400, "Enter a positive whole share quantity.");
  const day = new Date(input.transferDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transferDate) || Number.isNaN(day.getTime()) ||
      day.toISOString().slice(0, 10) !== input.transferDate || input.transferDate > new Date().toISOString().slice(0, 10)) {
    throw new CertificateError(400, "Enter a valid transfer date no later than today.");
  }
  const newRecipient = input.newRecipient ? { name: input.newRecipient.name.trim(), email: input.newRecipient.email?.trim() ?? "" } : null;
  if (newRecipient && (!newRecipient.name || (newRecipient.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newRecipient.email)))) {
    throw new CertificateError(400, "Enter the new recipient's name and a valid email address if provided.");
  }
  return newRecipient;
}
export async function transferInTransaction(tx: Transaction, originatorId: string, certificateId: string, input: TransferInput, actor: string) {
  const newRecipient = validateTransferInput(originatorId, input);
  const normalized = {
    originatorId, certificateId, recipientId: input.recipientId ?? null, newRecipient,
    quantity: input.quantity, transferDate: input.transferDate,
    reason: input.reason?.trim() ?? "", pricePerShare: input.pricePerShare ?? null,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.sources ? { sources: inputSources(certificateId, input) } : {}),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"share-transfer:" + input.requestId}, 0))`);
  const [replay] = await tx.select().from(shareTransfersTable).where(eq(shareTransfersTable.requestId, input.requestId));
  if (replay) {
    if (replay.requestFingerprint !== fingerprint) throw new CertificateError(409, "This request was already used with different transfer details. Start a new transfer.");
    return replay;
  }
  const { source, rows: sourceRows, allocations } = await lockTransferSources(tx, originatorId, certificateId, input);
  const recipientId = newRecipient ? randomUUID() : input.recipientId!;
  if (newRecipient) {
    const data = { name: newRecipient.name, email: newRecipient.email, familyLine: "", generationNumber: "", documents: [] };
    await tx.insert(shareholdersTable).values({
      id: recipientId,
      data,
    });
    await recordActivity(tx, { shareholderId: recipientId, name: newRecipient.name, actor,
      action: "Shareholder created for transfer", changes: profileChanges(undefined, data, false, false) });
  }
  // Lock both owners in deterministic order so simultaneous opposing transfers
  // cannot deadlock, and retain the same lock order as certificate issuance.
  const owners = await tx.select().from(shareholdersTable).where(inArray(shareholdersTable.id, [originatorId, recipientId]))
    .orderBy(shareholdersTable.id).for("update");
  const originator = owners.find(r => r.id === originatorId);
  const recipient = owners.find(r => r.id === recipientId);
  if (!originator || !recipient) throw new CertificateError(404, "Recipient or originator shareholder not found.");
  const issued = await issueCertificateInTransaction(tx, recipientId, {
    shareClass: source.shareClass, quantity: input.quantity, issueDate: input.transferDate,
    vestingSchedule: source.vestingSchedule, requestId: `transfer:${input.requestId}`,
  }, actor);
  for (const row of sourceRows) {
    const transferredQuantity = row.transferredQuantity + allocations.find(s => s.certificateId === row.id)!.quantity;
    await tx.update(certificatesTable).set({
      transferredQuantity, status: transferredQuantity === row.quantity ? "Transferred" : "Partially Transferred",
    }).where(eq(certificatesTable.id, row.id));
  }
  const [transfer] = await tx.insert(shareTransfersTable).values({
    id: randomUUID(), sourceCertificateId: source.id, sources: input.sources ? allocations : null, recipientCertificateId: issued.id,
    originatorId, recipientId,
    originatorName: String(originator.data.name), recipientName: String(recipient.data.name),
    shareClass: source.shareClass, quantity: input.quantity, transferDate: input.transferDate,
    reason: normalized.reason, pricePerShare: normalized.pricePerShare,
    attachments: input.attachments ?? [],
    requestId: input.requestId, requestFingerprint: fingerprint, recordedBy: actor,
  }).returning();
  await tx.update(shareholdersTable).set({ updatedAt: new Date() }).where(inArray(shareholdersTable.id, [originatorId, recipientId]));
  const details = [
    ...allocations.map(s => change("Source certificate allocation", null, `${s.certificateId}: ${s.quantity} shares`)),
    change("Recipient certificate", null, issued.id),
    change("Shares transferred", null, input.quantity), change("Transfer date", null, input.transferDate),
    change("Transfer reason", null, normalized.reason || null), change("Price per share", null, normalized.pricePerShare),
    ...(input.attachments ?? []).map(d => change("Transfer attachment", null, `${d.name} (${d.size} bytes)`)),
  ];
  await recordActivity(tx, { shareholderId: originatorId, name: String(originator.data.name), actor,
    action: `${input.quantity} ${source.shareClass} shares transferred to ${recipient.data.name} · ${allocations.map(s => s.certificateId).join(", ")} → ${issued.id}`,
    changes: [...details, change("Recipient", null, String(recipient.data.name)),
      ...sourceRows.flatMap(row => {
        const amount = allocations.find(s => s.certificateId === row.id)!.quantity;
        return [change(`${row.id} remaining shares`, remainingShares(row), remainingShares(row) - amount),
          change(`${row.id} status`, row.status, row.transferredQuantity + amount === row.quantity ? "Transferred" : "Partially Transferred")];
      })] });
  await recordActivity(tx, { shareholderId: recipientId, name: String(recipient.data.name), actor,
    action: `${input.quantity} ${source.shareClass} shares received from ${originator.data.name} · ${allocations.map(s => s.certificateId).join(", ")} → ${issued.id}`,
    changes: [...details, change("Originator", null, String(originator.data.name))] });
  return transfer;
}
