import { pgTable, text, bigint, date, timestamp, check, index, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { shareholdersTable } from "./shareholders";
import { certificatesTable } from "./certificates";

export const shareTransfersTable = pgTable("share_transfers", {
  id: text("id").primaryKey(),
  sourceCertificateId: text("source_certificate_id").notNull().references(() => certificatesTable.id, { onDelete: "restrict" }),
  sources: jsonb("sources").$type<{ certificateId: string; quantity: number }[]>(),
  recipientCertificateId: text("recipient_certificate_id").notNull().unique().references(() => certificatesTable.id, { onDelete: "restrict" }),
  originatorId: text("originator_id").notNull().references(() => shareholdersTable.id, { onDelete: "restrict" }),
  recipientId: text("recipient_id").notNull().references(() => shareholdersTable.id, { onDelete: "restrict" }),
  originatorName: text("originator_name").notNull(),
  recipientName: text("recipient_name").notNull(),
  shareClass: text("share_class").$type<"Common" | "Preferred">().notNull(),
  quantity: bigint("quantity", { mode: "number" }).notNull(),
  transferDate: date("transfer_date", { mode: "string" }).notNull(),
  reason: text("reason").notNull().default(""),
  attachments: jsonb("attachments").$type<{ name: string; objectPath: string; size: number }[]>().notNull().default([]),
  pricePerShare: text("price_per_share"),
  requestId: text("request_id").notNull().unique(),
  requestFingerprint: text("request_fingerprint").notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("transfer_different_owners", sql`${t.originatorId} <> ${t.recipientId}`),
  check("transfer_positive_quantity", sql`${t.quantity} > 0 AND ${t.quantity} <= 1000000000000`),
  index("transfer_originator_index").on(t.originatorId),
  index("transfer_recipient_index").on(t.recipientId),
]);
export const insertShareTransferSchema = createInsertSchema(shareTransfersTable);
export type ShareTransferRow = typeof shareTransfersTable.$inferSelect;
