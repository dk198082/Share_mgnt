import { pgTable, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { AuditChange } from "./shareholders";

export const settingsAuditTable = pgTable("settings_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  outcome: text("outcome").$type<"pending" | "succeeded" | "failed">().notNull(),
  changes: jsonb("changes").$type<AuditChange[]>().notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  index("settings_audit_created_idx").on(table.createdAt, table.id),
  check("settings_audit_outcome_check", sql`${table.outcome} IN ('pending', 'succeeded', 'failed')`),
]);
export const insertSettingsAuditSchema = createInsertSchema(settingsAuditTable);
export type SettingsAudit = typeof settingsAuditTable.$inferSelect;
