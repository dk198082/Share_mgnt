import { randomUUID } from "node:crypto";
import { db, pool, settingsAuditTable, type AuditChange } from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { auditContext, change } from "./audit";
import { CertificateError, type Transaction } from "./certificates";

type Input = { action: string; targetId: string; changes: AuditChange[] };
export function settingsEvent(input: Input) {
  const actor = auditContext.getStore();
  if (!actor) throw new Error("Settings audit requires an employee identity.");
  return { id: randomUUID(), actorId: actor.id, actorName: actor.name, ...input };
}
export async function recordSettingsChange(tx: Transaction, input: Input) {
  if (!input.changes.length) return;
  await tx.insert(settingsAuditTable).values({ ...settingsEvent(input), outcome: "succeeded", completedAt: new Date() });
}
export const compactPrice = (value: string | null) => value === null ? null : value.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
export function priceChanges(before: { commonPrice: string | null; preferredPrice: string | null } | undefined, after: { common: string; preferred: string }) {
  return [change("Common price", compactPrice(before?.commonPrice ?? null), compactPrice(after.common)),
    change("Preferred price", compactPrice(before?.preferredPrice ?? null), compactPrice(after.preferred))]
    .filter(c => c.before !== c.after);
}
type Signer = { name: string; email: string; signaturePath: string; emailNotificationsEnabled?: boolean };
export function signoffChanges(before?: Signer, after?: Signer): AuditChange[] {
  const changes = [change("Name", before?.name ?? null, after?.name ?? null), change("Email", before?.email ?? null, after?.email ?? null)];
  const beforeEmailEnabled = before?.emailNotificationsEnabled ?? true;
  const afterEmailEnabled = after?.emailNotificationsEnabled ?? true;
  if (beforeEmailEnabled !== afterEmailEnabled)
    changes.push(change("Approval email notifications", beforeEmailEnabled ? "Enabled" : "Disabled", afterEmailEnabled ? "Enabled" : "Disabled"));
  if (before?.signaturePath !== after?.signaturePath) changes.push(change("Signature", before ? "Signature on file" : null,
    after ? (before ? "Signature replaced" : "Signature added") : null, true));
  return changes.filter(c => c.before !== c.after);
}

// Session lock serializes access safeguards, but each audit write commits
// independently. Never wrap Clerk calls in a database transaction.
type AuditStore = Pick<typeof db, "insert" | "update">;
export async function withAccessLock<T>(fn: (store: AuditStore) => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  let destroy = false;
  try {
    await connection.query("SELECT pg_advisory_lock(hashtextextended('settings-user-access',0))");
    // Use the reserved connection for auto-committed audit writes too. Lock
    // waiters must not exhaust the pool while the lock owner needs a connection.
    return await fn(drizzle(connection));
  } finally {
    try { await connection.query("SELECT pg_advisory_unlock(hashtextextended('settings-user-access',0))"); }
    catch { destroy = true; }
    connection.release(destroy);
  }
}

export async function externalSettingsChange<T>(input: Input, mutate: () => Promise<T>, store: AuditStore = db): Promise<T> {
  const event = settingsEvent(input);
  // Fail closed: if this insert fails, do not call the external service.
  await store.insert(settingsAuditTable).values({ ...event, outcome: "pending", detail: "External change requested; completion not yet confirmed." });
  let result: T;
  try { result = await mutate(); }
  catch (error) {
    const status = (error as { status?: number })?.status;
    // Timeouts, transport errors and 5xx can follow an applied mutation.
    const rejected = typeof status === "number" && status >= 400 && status < 500 && status !== 408;
    try {
      await store.update(settingsAuditTable).set({
        outcome: rejected ? "failed" : "pending",
        detail: rejected ? "Account service rejected the change." : "Account service outcome is unknown. Check current access before retrying.",
        completedAt: rejected ? new Date() : null,
      }).where(eq(settingsAuditTable.id, event.id));
    } catch {
      throw new CertificateError(503, "Access outcome could not be recorded. Audit remains pending. Check current access before retrying.");
    }
    if (!rejected) throw new CertificateError(502, "Account service outcome is unknown. Audit remains pending. Check current access before retrying.");
    throw error;
  }
  try {
    await store.update(settingsAuditTable).set({ outcome: "succeeded", completedAt: new Date(), detail: null }).where(eq(settingsAuditTable.id, event.id));
  } catch {
    throw new CertificateError(503, "Access change succeeded, but its audit completion could not be saved. Audit remains pending. Do not repeat the change; refresh current access.");
  }
  return result;
}
