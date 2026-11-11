import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { activityTable, type AuditChange } from "@workspace/db";
import type { Transaction } from "./certificates";

export const auditContext = new AsyncLocalStorage<{ id: string; name: string }>();
type AuditInput = { shareholderId: string; name: string; actor: string; action: string; changes?: AuditChange[] };
export async function recordActivity(tx: Transaction, input: AuditInput) {
  const employee = auditContext.getStore();
  await tx.insert(activityTable).values({
    id: randomUUID(), ...input, changes: input.changes ?? [],
    actorName: employee?.id === input.actor ? employee.name : input.actor,
  });
}
export function change(field: string, before: string | number | null, after: string | number | null, protectedValue = false): AuditChange {
  return { field, before: before === null ? null : String(before), after: after === null ? null : String(after), protected: protectedValue };
}
const fields: Record<string, string> = {
  name: "Name", email: "Email", dateOfBirth: "Date of birth", dateOfPassing: "Date of passing",
  address: "Address", phone: "Phone number", familyLine: "Family line",
  generationNumber: "Generation number (External ID)", financialNotes: "Financial information",
};
type Data = Record<string, unknown>;
const str = (v: unknown): string | null => v === undefined || v === null || v === "" ? null : String(v);
type Doc = { objectPath: string; name: string; size: number };
function docs(data?: Data): Doc[] {
  return Array.isArray(data?.documents) ? data.documents as Doc[] : [];
}
function docLabel(d: Doc) { return `${d.name} (${d.size} bytes)`; }
// Whitelisted fields only: never serialize ciphertext, last four digits, storage
// URLs, or an entire request body into audit history.
export function profileChanges(before: Data | undefined, after: Data, ssnChanged: boolean, hadSsn: boolean): AuditChange[] {
  const result: AuditChange[] = [];
  for (const [key, label] of Object.entries(fields)) {
    if (str(before?.[key]) !== str(after[key])) result.push(change(label, str(before?.[key]), str(after[key])));
  }
  if (str(before?.picturePath) !== str(after.picturePath)) {
    result.push(change("Picture", before?.picturePath ? "Picture on file" : null,
      after.picturePath ? (before?.picturePath ? "Picture replaced" : "Picture added") : null));
  }
  const oldDocs = docs(before), newDocs = docs(after);
  for (const old of oldDocs) {
    const current = newDocs.find(d => d.objectPath === old.objectPath);
    if (!current) result.push(change("Document removed", docLabel(old), null));
    else if (docLabel(old) !== docLabel(current)) result.push(change("Document details", docLabel(old), docLabel(current)));
  }
  for (const doc of newDocs) if (!oldDocs.some(d => d.objectPath === doc.objectPath)) result.push(change("Document added", null, docLabel(doc)));
  if (ssnChanged) result.push(change("SSN", hadSsn ? "Protected value on file" : null, hadSsn ? "Protected value updated" : "Protected value added", true));
  return result;
}
