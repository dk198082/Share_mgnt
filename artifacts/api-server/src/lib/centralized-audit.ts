import { db } from "@workspace/db";
import { ListSettingsAuditResponse, ListSettingsAuditQueryParams } from "@workspace/api-zod";
import { CertificateError, type Transaction } from "./certificates";
import { auditAnchorQuery, auditPageQuery } from "./centralized-audit-query";

// Read existing records in place. No backfill, duplicated audit writes, or changes
// to the shareholder/transfer history sources are needed.

type EventRow = {
  key: string; id: string; actor_id: string; actor_name: string; action: string;
  target_id: string; outcome: string; changes: unknown; detail: string | null;
  created_at: Date | string; completed_at: Date | string | null; source: string; category: string;
  shareholder_id: string | null; shareholder_name: string | null; detailed: boolean;
};

export async function loadCentralizedAudit(
  params: ReturnType<typeof ListSettingsAuditQueryParams.parse> = {},
  reader: Pick<Transaction, "execute"> = db,
) {
  // Keep calendar dates as strings. Reject JS's normalization of impossible dates
  // (e.g. February 30) before PostgreSQL casts them, including year zero.
  for (const day of [params.from, params.to]) {
    if (day === undefined) continue;
    const instant = new Date(`${day}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")
      || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== day) {
      throw new CertificateError(400, "Audit dates must be valid UTC calendar dates (YYYY-MM-DD).");
    }
  }
  if (params.from && params.to && params.from > params.to) {
    throw new CertificateError(400, "Audit from date must be on or before the to date.");
  }
  // Accept old settings UUID cursors as well as source-qualified cursors.
  const cursor = params.before
    ? (params.before.includes(":") ? params.before : `administration:${params.before}`)
    : null;
  if (cursor) {
    const anchor = await reader.execute(auditAnchorQuery(cursor));
    if (!anchor.rows.length) throw new CertificateError(400, "Audit cursor not found.");
  }
  // PostgreSQL compares the original timestamps, retaining microseconds. The
  // source-qualified key disambiguates IDs shared by the two source tables.
  const result = await reader.execute(auditPageQuery({
    cursor, category: params.category, search: params.search, from: params.from, to: params.to,
  }));
  const rows = result.rows as EventRow[];
  const page = rows.slice(0, 50);
  return ListSettingsAuditResponse.parse({
    entries: page.map(row => ({
      id: row.key, actorId: row.actor_id, actorName: row.actor_name,
      action: row.action, targetId: row.target_id, outcome: row.outcome,
      changes: row.changes, detail: row.detail,
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      source: row.source, category: row.category,
      shareholderId: row.shareholder_id, shareholderName: row.shareholder_name,
      detailed: row.detailed,
    })),
    nextCursor: rows.length > 50 ? page[page.length - 1].key : null,
  });
}
