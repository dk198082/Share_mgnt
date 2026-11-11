import { sql } from "drizzle-orm";
import { pgTable, serial, text, date, timestamp, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const sharePriceHistoryTable = pgTable("share_price_history", {
  id: serial("id").primaryKey(),
  common: text("common"),
  preferred: text("preferred"),
  effectiveDate: date("effective_date", { mode: "string" }),
  currency: text("currency").notNull().default("USD"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: text("recorded_by").notNull(),
  recordedById: text("recorded_by_id"),
  reason: text("reason"),
}, (t) => [
  index("share_price_effective_idx").on(t.effectiveDate, t.id),
  check("share_price_currency", sql`${t.currency} = 'USD'`),
  check("share_price_common", sql`${t.common} IS NULL OR ${t.common} ~ '^[0-9]{1,18}(\\.[0-9]{1,6})?$'`),
  check("share_price_preferred", sql`${t.preferred} IS NULL OR ${t.preferred} ~ '^[0-9]{1,18}(\\.[0-9]{1,6})?$'`),
  check("share_price_dated_values", sql`${t.effectiveDate} IS NULL OR (${t.common} IS NOT NULL AND ${t.preferred} IS NOT NULL)`),
]);
export const insertSharePriceHistorySchema = createInsertSchema(sharePriceHistoryTable);
export type SharePriceRecord = typeof sharePriceHistoryTable.$inferSelect;
