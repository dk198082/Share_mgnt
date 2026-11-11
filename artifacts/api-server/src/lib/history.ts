import { and, desc, eq, sql } from "drizzle-orm";
import { activityTable, shareholdersTable } from "@workspace/db";
import { CertificateError, type Transaction } from "./certificates";

export async function loadHistoryPage(tx: Transaction, shareholderId: string, before?: string) {
  const [holder] = await tx.select({ id: shareholdersTable.id }).from(shareholdersTable).where(eq(shareholdersTable.id, shareholderId));
  if (!holder) throw new CertificateError(404, "Shareholder not found.");
  const where = eq(activityTable.shareholderId, shareholderId);
  let cursorFilter;
  if (before) {
    const [cursor] = await tx.select({ id: activityTable.id }).from(activityTable).where(and(where, eq(activityTable.id, before)));
    if (!cursor) throw new CertificateError(400, "The history cursor is not valid for this shareholder.");
    // Compare using PostgreSQL's full timestamp precision, not JS Date's
    // truncated milliseconds, so rapid edits cannot disappear between pages.
    cursorFilter = sql`(${activityTable.createdAt}, ${activityTable.id}) <
      (SELECT created_at, id FROM shareholder_activity WHERE shareholder_id = ${shareholderId} AND id = ${before})`;
  }
  const rows = await tx.select().from(activityTable).where(and(where, cursorFilter))
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id)).limit(51);
  const entries = rows.slice(0, 50);
  return { entries, nextCursor: rows.length > 50 ? entries[entries.length - 1].id : null };
}
