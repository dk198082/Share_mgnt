import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Structured staging only. Source workbook bytes are never stored in PostgreSQL. */
export const legacyImportRunsTable = pgTable("legacy_import_runs", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  status: text("status").$type<"ready" | "blocked" | "committed">().notNull(),
  operatorId: text("operator_id").notNull(),
  operatorName: text("operator_name").notNull(),
  committedBy: text("committed_by"),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});
export const insertLegacyImportRunSchema = createInsertSchema(legacyImportRunsTable);
