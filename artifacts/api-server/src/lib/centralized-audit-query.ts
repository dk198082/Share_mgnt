import { sql } from "drizzle-orm";

// Shared projection for the read-only company-wide history.
const administrationEvents = sql`
  SELECT 'administration:' || id AS key, id, actor_id, actor_name, action,
    target_id, outcome, changes, detail, created_at, completed_at,
    'administration'::text AS source, 'administration'::text AS category,
    NULL::text AS shareholder_id, NULL::text AS shareholder_name,
    true AS detailed
  FROM settings_audit
`;
const shareholderEvents = sql`
  SELECT 'shareholder:' || id AS key, id, actor AS actor_id,
    COALESCE(NULLIF(actor_name, ''), 'Unknown employee') AS actor_name, action,
    shareholder_id AS target_id, 'succeeded'::text AS outcome,
    COALESCE(changes, '[]'::jsonb) AS changes, NULL::text AS detail, created_at,
    NULL::timestamptz AS completed_at, 'shareholder'::text AS source,
    CASE
      WHEN lower(action) LIKE '%approved%' OR lower(action) LIKE '%rejected%' THEN 'approvals'
      WHEN lower(action) LIKE '%files %' OR lower(action) LIKE '%file added%' OR lower(action) LIKE '%document%' OR lower(action) LIKE '%pdf%' THEN 'documents'
      WHEN lower(action) LIKE '%transfer%' OR lower(action) LIKE '%shares received%' THEN 'transfers'
      WHEN lower(action) LIKE '%issuance%' OR lower(action) LIKE '% issued%' THEN 'issuance'
      ELSE 'shareholders'
    END AS category,
    shareholder_id, name AS shareholder_name, changes IS NOT NULL AS detailed
  FROM shareholder_activity
`;
export const auditEvents = sql`${administrationEvents} UNION ALL ${shareholderEvents}`;

export type AuditQueryOptions = { cursor: string | null; category?: string; search?: string; from?: string; to?: string };

export function auditAnchorQuery(cursor: string) {
  const separator = cursor.indexOf(":");
  const source = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  // Match on the original primary key, not a concatenation of every history ID.
  if (source === "administration") {
    return sql`SELECT 'administration:' || id AS key, created_at FROM settings_audit WHERE id = ${id}`;
  }
  if (source === "shareholder") {
    return sql`SELECT 'shareholder:' || id AS key, created_at FROM shareholder_activity WHERE id = ${id}`;
  }
  return sql`SELECT NULL::text AS key, NULL::timestamptz AS created_at WHERE false`;
}

export function auditPageQuery({ cursor, category, search: input, from, to }: AuditQueryOptions) {
  const categoryFilter = category && category !== "all"
    ? sql`category = ${category}` : sql`true`;
  const search = input?.trim() ?? "";
  const searchFilter = search
    ? sql`strpos(lower(concat_ws(' ', action, actor_name, shareholder_name, target_id)), lower(${search})) > 0`
    : sql`true`;
  const fromFilter = from
    ? sql`created_at >= (${from}::date::timestamp AT TIME ZONE 'UTC')` : sql`true`;
  // Exclusive next midnight includes PostgreSQL microseconds at the end of the
  // selected day and is independent of the connection's timezone or DST.
  const toFilter = to
    ? sql`created_at < ((${to}::date + interval '1 day') AT TIME ZONE 'UTC')` : sql`true`;
  const cursorFilter = cursor
    ? sql`created_at <= (SELECT created_at FROM anchor)
        AND (created_at, key) < (SELECT created_at, key FROM anchor)`
    : sql`true`;
  // Each source can contribute at most 51 rows to the global top 51. Limiting
  // each branch permits bounded top-N sorts instead of a full wide-row disk
  // sort. Never materialize the entire history to find a single cursor.
  const branch = (projection: typeof auditEvents) => sql`
    (SELECT * FROM (${projection}) AS events
      WHERE ${categoryFilter} AND ${searchFilter} AND ${fromFilter} AND ${toFilter} AND ${cursorFilter}
      ORDER BY created_at DESC, key DESC LIMIT 51)
  `;
  // The action-derived shareholder CASE can never be "administration", but the
  // planner does not infer that. Exclude the impossible source explicitly rather
  // than scanning it just to return zero matches.
  const projections = category === "administration" ? [administrationEvents]
    : category && category !== "all" ? [shareholderEvents]
    : [administrationEvents, shareholderEvents];
  return sql`
    WITH ${cursor ? sql`anchor AS (${auditAnchorQuery(cursor)}),` : sql``}
    events AS (${sql.join(projections.map(branch), sql` UNION ALL `)})
    SELECT * FROM events
    ORDER BY created_at DESC, key DESC LIMIT 51
  `;
}
