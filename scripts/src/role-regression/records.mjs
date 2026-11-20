import {
  db, pool, shareholdersTable, certificatesTable, shareTransfersTable, transferRequestsTable, signoffsTable,
  legacyImportRunsTable,
} from "../../../lib/db/src/index.ts";
import { identities } from "./oidc-fixture.mjs";

export const holder = { id: "fixture-holder", name: "Fictional Shareholder" };
export const recipient = { id: "fixture-recipient", name: "Fictional Recipient" };
export const transfer = "fixture-transfer";
export const requestId = "85969af4-ef9b-4f75-9450-50a4be0a1baa";
export const importId = "legacy-import-aabbccddeeffaabbccddeeff";
export const uploadId = "fixture-upload";
export const signerId = "fixture-signer-editor";
export const historyDate = "2024-02-01";

export async function seed() {
  for (const { id, name } of [holder, recipient]) {
    await db.insert(shareholdersTable).values({ id, data: {
      name, email: "", phone: "", address: "", dateOfBirth: "", dateOfPassing: "", familyLine: "",
      generationNumber: "", financialNotes: "", picturePath: "", documents: [],
    } });
  }
  const certificate = { shareClass: "Common", issueDate: "2024-01-01", vestingSchedule: "Immediate", issuedBy: "fixture" };
  await db.insert(certificatesTable).values([
    { ...certificate, id: "C-1", sequenceNumber: 1, shareholderId: holder.id, quantity: 20, transferredQuantity: 5,
      status: "Partially Transferred", requestId: "fixture-certificate-1" },
    { ...certificate, id: "C-2", sequenceNumber: 2, shareholderId: recipient.id, quantity: 5,
      issueDate: historyDate, requestId: "fixture-certificate-2" },
  ]);
  const parties = { originatorId: holder.id, originatorName: holder.name, recipientId: recipient.id,
    recipientName: recipient.name, sourceCertificateId: "C-1", shareClass: "Common" };
  await db.insert(shareTransfersTable).values({ ...parties, id: transfer, recipientCertificateId: "C-2", quantity: 5,
    transferDate: historyDate, requestId: "fixture-completed-request", requestFingerprint: "fictional", recordedBy: "fixture" });
  // Both users are named signers; the viewer must be blocked by role, not by identity mismatch.
  const signers = Object.entries(identities).map(([role, identity]) => ({ id: `fixture-signer-${role}`,
    name: identity.name, email: identity.email, signaturePath: "/objects/uploads/fixture-signature", emailNotificationsEnabled: false }));
  await db.insert(signoffsTable).values(signers.map(s => ({ ...s, updatedBy: "fixture" })));
  await db.insert(transferRequestsTable).values({ ...parties, id: requestId, fingerprint: "fictional", requestedBy: "fixture",
    vestingSchedule: "Immediate", requiredSigners: signers, input: { requestId, quantity: 2, transferDate: historyDate, recipientId: recipient.id } });
  await db.insert(legacyImportRunsTable).values({ id: importId, fingerprint: "fictional", status: "ready",
    operatorId: identities.editor.id, operatorName: "Editor Fixture", payload: {}, report: {
      sources: [], counts: { shareholders: 0, certificates: 0, transfers: 0, excludedSecurities: 0, commonShares: 0, preferredShares: 0 },
      issues: [], balances: [], shareholderIds: [],
    } });
}

export async function snapshotRecords() {
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const snapshot = {};
  for (const { tablename } of rows) {
    if (tablename === "sessions") continue;
    if (!/^[a-z_]+$/.test(tablename)) throw new Error(`Unexpected table name: ${tablename}`);
    const result = await pool.query(`SELECT to_jsonb(t)::text AS row FROM public."${tablename}" t ORDER BY 1`);
    snapshot[tablename] = result.rows.map(entry => entry.row);
  }
  return snapshot;
}
