import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { shareholdersTable, certificatesTable, activityTable } from "@workspace/db";
import { CertificateError, issueCertificateInTransaction, remainingShares, type Transaction } from "./certificates";
import { transferInTransaction } from "./transfers";
import { profileChanges, recordActivity, change, auditContext } from "./audit";
import { recordSettingsChange } from "./settings-audit";

export const PILOT_DATA_MARKER = "pilot-fixtures-shareholders-v1";
const people = [
  ["Alex Morgan", "Morgan", "1970-03-14"], ["Jamie Morgan", "Morgan", "1973-07-22"],
  ["Taylor Morgan", "Morgan", "1997-11-06"], ["Casey Morgan", "Morgan", "2000-02-18"],
  ["Jordan Bennett", "Bennett", "1968-05-12"], ["Avery Bennett", "Bennett", "1971-09-25"],
  ["Riley Bennett", "Bennett", "1995-01-09"], ["Cameron Bennett", "Bennett", "1999-06-30"],
  ["Drew Parker", "Parker", "1965-08-17"], ["Quinn Parker", "Parker", "1970-12-03"],
  ["Reese Parker", "Parker", "1994-04-21"], ["Skyler Parker", "Parker", "1998-10-08"],
] as const;
export const PILOT_SHAREHOLDER_IDS = people.map((_, i) => `pilot-shareholder-${String(i + 1).padStart(3, "0")}`);

export async function pilotDataStatus(tx: Transaction) {
  const [done] = await tx.select({ id: activityTable.id }).from(activityTable).where(eq(activityTable.id, PILOT_DATA_MARKER));
  const existing = await tx.select({ id: shareholdersTable.id }).from(shareholdersTable)
    .where(inArray(shareholdersTable.id, PILOT_SHAREHOLDER_IDS));
  const state = done && existing.length === 12 ? "imported" : !done && existing.length === 0 ? "available" : "conflict";
  return { state, pilotShareholders: existing.length } as { state: "imported" | "available" | "conflict"; pilotShareholders: number };
}

/** Explicit, authenticated application action, never a startup/deployment hook.
 * Uses this database's ledger counters, not certificate numbers copied from development.
 * Does not create approval requests, signatures, email outboxes or legal certificate PDFs.
 */
export async function importPilotDataInTransaction(tx: Transaction, actor: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${PILOT_DATA_MARKER}, 0))`);
  const status = await pilotDataStatus(tx);
  if (status.state === "imported") return { alreadyImported: true, shareholdersAdded: 0, certificatesAdded: 0, transfersAdded: 0 };
  if (status.state === "conflict") throw new CertificateError(409, "Incomplete or conflicting pilot data already exists. Nothing was changed. Review the existing pilot records before importing.");
  const opening = [];
  for (const [i, [name, family, birth]] of people.entries()) {
    const data = {
      name: `PILOT — ${name}`, email: `pilot.${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
      dateOfBirth: birth, dateOfPassing: "", ssnMasked: "",
      address: `${100 + i} Fictional Lane, Sample City (pilot data)`,
      phone: `202-555-${String(100 + i).padStart(4, "0")}`,
      familyLine: `PILOT — ${family}`, generationNumber: `PILOT-${Math.floor(i % 4 / 2) + 1}-${String(i + 1).padStart(3, "0")}`,
      financialNotes: "FICTIONAL PILOT DATA — not a real person or financial position. Opening certificates and example transfers were imported for testing, without sign-offs, notifications, or legal certificate PDFs. No SSN is stored.",
      picturePath: "", documents: [],
    };
    await tx.insert(shareholdersTable).values({ id: PILOT_SHAREHOLDER_IDS[i], data });
    await recordActivity(tx, { shareholderId: PILOT_SHAREHOLDER_IDS[i], name: data.name, actor,
      action: "Fictional pilot shareholder imported", changes: profileChanges(undefined, data, false, false) });
    const common = await issueCertificateInTransaction(tx, PILOT_SHAREHOLDER_IDS[i], {
      requestId: `${PILOT_DATA_MARKER}:${i}:common`, shareClass: "Common", quantity: 1000 + i * 100,
      issueDate: "2026-01-15", vestingSchedule: "Fully vested upon grant",
    }, actor);
    const preferred = await issueCertificateInTransaction(tx, PILOT_SHAREHOLDER_IDS[i], {
      requestId: `${PILOT_DATA_MARKER}:${i}:preferred`, shareClass: "Preferred", quantity: 100 + i * 25,
      issueDate: "2026-02-15", vestingSchedule: "Fully vested upon grant",
    }, actor);
    opening.push({ common, preferred });
  }
  const examples = [
    { from: 0, to: 1, source: opening[0].common, quantity: 125, date: "2026-03-10", reason: "Gift" },
    { from: 6, to: 7, source: opening[6].preferred, quantity: 250, date: "2026-04-20", reason: "Gift" },
    { from: 3, to: 8, source: opening[3].common, quantity: 300, date: "2026-05-12", reason: "Donation" },
  ];
  for (const [i, example] of examples.entries()) {
    await transferInTransaction(tx, PILOT_SHAREHOLDER_IDS[example.from], example.source.id, {
      requestId: `${PILOT_DATA_MARKER}:transfer:${i}`, recipientId: PILOT_SHAREHOLDER_IDS[example.to],
      quantity: example.quantity, transferDate: example.date, reason: example.reason,
    }, actor);
  }
  const certificates = await tx.select().from(certificatesTable)
    .where(inArray(certificatesTable.shareholderId, PILOT_SHAREHOLDER_IDS));
  assert.equal(certificates.length, 27);
  assert.equal(certificates.reduce((sum, c) => sum + remainingShares(c), 0), 21450);
  assert.equal(certificates.filter(c => c.status === "Partially Transferred").length, 2);
  assert.equal(certificates.filter(c => c.status === "Transferred").length, 1);
  await recordSettingsChange(tx, {
    action: "Fictional pilot data imported", targetId: PILOT_DATA_MARKER,
    changes: [change("Pilot Shareholders added", 0, 12), change("Pilot certificates added", 0, 27),
      change("Example transfers added", 0, 3), change("Approval and notification handling", null, "Fictional import only; no approvals, emails or legal PDFs")],
  });
  await tx.insert(activityTable).values({
    id: PILOT_DATA_MARKER, shareholderId: PILOT_SHAREHOLDER_IDS[0], name: "PILOT sample dataset",
    actor, actorName: auditContext.getStore()?.name ?? actor,
    action: "Fictional pilot import completed: 12 shareholders, 24 opening certificates, 3 transfers", changes: [],
  });
  return { alreadyImported: false, shareholdersAdded: 12, certificatesAdded: 27, transfersAdded: 3 };
}
