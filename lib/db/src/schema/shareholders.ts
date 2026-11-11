import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const shareholdersTable = pgTable("shareholders", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  ssnEncrypted: text("ssn_encrypted"),
  ssnLast4: text("ssn_last4"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AuditChange = { field: string; before: string | null; after: string | null; protected: boolean };
export const activityTable = pgTable("shareholder_activity", {
  id: text("id").primaryKey(),
  shareholderId: text("shareholder_id").notNull(),
  name: text("name").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  actorName: text("actor_name"),
  changes: jsonb("changes").$type<AuditChange[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("shareholder_activity_history_index").on(t.shareholderId, t.createdAt, t.id)]);
export const uploadsTable = pgTable("shareholder_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  purpose: text("purpose").notNull().default("profile"),
});
export const insertShareholderSchema = createInsertSchema(shareholdersTable);
export type ShareholderRow = typeof shareholdersTable.$inferSelect;
