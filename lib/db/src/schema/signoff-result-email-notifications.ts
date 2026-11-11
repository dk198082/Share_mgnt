import { pgTable, text, integer, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { transferRequestsTable } from "./transfer-requests";

export type SignoffResultEmailStatus = "Pending" | "Sending" | "Accepted" | "Failed" | "Unknown";

export const signoffResultEmailNotificationsTable = pgTable("signoff_result_email_notifications", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => transferRequestsTable.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  appOrigin: text("app_origin").notNull(),
  outcome: text("outcome").$type<"Approved" | "Rejected">().notNull(),
  status: text("status").$type<SignoffResultEmailStatus>().notNull().default("Pending"),
  attempts: integer("attempts").notNull().default(0),
  providerStatus: integer("provider_status"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, t => [
  uniqueIndex("signoff_result_email_request_unique").on(t.requestId),
  index("signoff_result_email_status_created_index").on(t.status, t.createdAt),
  check("signoff_result_email_outcome_valid", sql`${t.outcome} IN ('Approved', 'Rejected')`),
  check("signoff_result_email_status_valid", sql`${t.status} IN ('Pending', 'Sending', 'Accepted', 'Failed', 'Unknown')`),
  check("signoff_result_email_attempts_nonnegative", sql`${t.attempts} >= 0`),
]);

export const insertSignoffResultEmailNotificationSchema = createInsertSchema(signoffResultEmailNotificationsTable).omit({
  createdAt: true, updatedAt: true, acceptedAt: true,
});
export type InsertSignoffResultEmailNotification = typeof signoffResultEmailNotificationsTable.$inferInsert;
export type SignoffResultEmailNotification = typeof signoffResultEmailNotificationsTable.$inferSelect;
