import { pgTable, text, integer, bigint, date, timestamp, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { shareholdersTable } from "./shareholders";

export const certificateCountersTable = pgTable("certificate_counters", {
  shareClass: text("share_class").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => [
  check("counter_class_valid", sql`${t.shareClass} IN ('Common', 'Preferred')`),
  check("counter_nonnegative", sql`${t.lastNumber} >= 0`),
]);

export const certificatesTable = pgTable("certificates", {
  id: text("id").primaryKey(),
  sequenceNumber: integer("sequence_number").notNull(),
  shareholderId: text("shareholder_id").notNull().references(() => shareholdersTable.id, { onDelete: "restrict" }),
  shareClass: text("share_class").$type<"Common" | "Preferred">().notNull(),
  quantity: bigint("quantity", { mode: "number" }).notNull(),
  transferredQuantity: bigint("transferred_quantity", { mode: "number" }).notNull().default(0),
  issueDate: date("issue_date", { mode: "string" }),
  status: text("status").$type<"Outstanding" | "Partially Transferred" | "Transferred" | "Cancelled">().notNull().default("Outstanding"),
  vestingSchedule: text("vesting_schedule").notNull(),
  requestId: text("request_id").notNull().unique(),
  issuedBy: text("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("certificate_class_sequence_unique").on(t.shareClass, t.sequenceNumber),
  check("certificate_class_valid", sql`${t.shareClass} IN ('Common', 'Preferred')`),
  check("certificate_quantity_positive", sql`${t.quantity} > 0 AND ${t.quantity} <= 1000000000000`),
  check("certificate_number_positive", sql`${t.sequenceNumber} > 0`),
  check("certificate_id_matches_sequence", sql`${t.id} = (CASE WHEN ${t.shareClass} = 'Common' THEN 'C-' ELSE 'P-' END) || ${t.sequenceNumber}::text`),
  check("certificate_status_valid", sql`${t.status} IN ('Outstanding', 'Partially Transferred', 'Transferred', 'Cancelled')`),
  check("certificate_transferred_range", sql`${t.transferredQuantity} >= 0 AND ${t.transferredQuantity} <= ${t.quantity}`),
]);

export const insertCertificateSchema = createInsertSchema(certificatesTable);
export type CertificateRow = typeof certificatesTable.$inferSelect;
