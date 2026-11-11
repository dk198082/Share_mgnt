import { pgTable, text, integer, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { transferRequestsTable } from "./transfer-requests";

export type SignoffEmailStatus = "Pending" | "Sending" | "Accepted" | "Failed" | "Unknown" | "Skipped";

export const signoffEmailNotificationsTable = pgTable("signoff_email_notifications", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => transferRequestsTable.id, { onDelete: "cascade" }),
  signerId: text("signer_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  appOrigin: text("app_origin").notNull(),
  status: text("status").$type<SignoffEmailStatus>().notNull().default("Pending"),
  attempts: integer("attempts").notNull().default(0),
  providerStatus: integer("provider_status"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, t => [
  uniqueIndex("signoff_email_request_signer_unique").on(t.requestId, t.signerId),
  index("signoff_email_status_created_index").on(t.status, t.createdAt),
  check("signoff_email_status_valid", sql`${t.status} IN ('Pending', 'Sending', 'Accepted', 'Failed', 'Unknown', 'Skipped')`),
  check("signoff_email_attempts_nonnegative", sql`${t.attempts} >= 0`),
]);

export const insertSignoffEmailNotificationSchema = createInsertSchema(signoffEmailNotificationsTable).omit({
  createdAt: true, updatedAt: true, acceptedAt: true,
});
export type InsertSignoffEmailNotification = typeof signoffEmailNotificationsTable.$inferInsert;
export type SignoffEmailNotification = typeof signoffEmailNotificationsTable.$inferSelect;
