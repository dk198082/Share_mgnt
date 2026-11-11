import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Run after schema push. One transaction preserves the original undated settings
// and protects the history from UPDATE, DELETE and TRUNCATE, including direct SQL.
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO share_price_history (id, common, preferred, effective_date, recorded_at, recorded_by, recorded_by_id, reason)
      SELECT 0, common_price::text, preferred_price::text, NULL, updated_at, updated_by, updated_by,
        'Legacy settings; effective date and event-time employee name were not recorded.'
      FROM company_settings WHERE id = 'company' AND (common_price IS NOT NULL OR preferred_price IS NOT NULL)
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION reject_share_price_history_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Share price history is immutable; append a correction instead.'; END;
      $$
    `);
    await tx.execute(sql`DROP TRIGGER IF EXISTS immutable_share_prices ON share_price_history`);
    await tx.execute(sql`
      CREATE TRIGGER immutable_share_prices BEFORE UPDATE OR DELETE OR TRUNCATE ON share_price_history
      FOR EACH STATEMENT EXECUTE FUNCTION reject_share_price_history_mutation()
    `);
  });
} finally {
  await pool.end();
}
