import { pgTable, text, jsonb, timestamp, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { shareholdersTable } from "./shareholders";
import { certificatesTable } from "./certificates";
import { shareTransfersTable } from "./transfers";

export type RequestedTransferInput = {
  requestId: string; recipientId?: string; newRecipient?: { name: string; email?: string };
  quantity: number; transferDate: string; reason?: string; pricePerShare?: string;
  sources?: { certificateId: string; quantity: number }[];
  attachments?: { name: string; objectPath: string; size: number }[];
};
export type ApprovalSigner = { id: string; name: string; email: string; signaturePath: string; emailNotificationsEnabled?: boolean };
export type ApprovalVote = ApprovalSigner & { userId: string; approvedAt: string };
export type RequestedIssuance = { requestId: string; shareClass: "Common" | "Preferred"; quantity: number; issueDate: string; vestingSchedule: string };
export const transferRequestsTable = pgTable("transfer_requests", {
  id: text("id").primaryKey(),
  originatorId: text("originator_id").notNull().references(() => shareholdersTable.id, { onDelete: "restrict" }),
  originatorName: text("originator_name").notNull(),
  recipientId: text("recipient_id").references(() => shareholdersTable.id, { onDelete: "restrict" }),
  recipientName: text("recipient_name").notNull(),
  sourceCertificateId: text("source_certificate_id").references(() => certificatesTable.id, { onDelete: "restrict" }),
  kind: text("kind").$type<"Transfer" | "Issuance">().notNull().default("Transfer"),
  requiredSigners: jsonb("required_signers").$type<ApprovalSigner[]>(),
  approvals: jsonb("approvals").$type<ApprovalVote[]>().notNull().default([]),
  issuance: jsonb("issuance").$type<RequestedIssuance>(),
  shareClass: text("share_class").$type<"Common" | "Preferred">().notNull(),
  vestingSchedule: text("vesting_schedule").notNull(),
  input: jsonb("input").$type<RequestedTransferInput>().notNull(),
  fingerprint: text("fingerprint").notNull(),
  requestedBy: text("requested_by").notNull(),
  requesterEmail: text("requester_email"),
  appOrigin: text("app_origin"),
  status: text("status").$type<"Pending" | "Completed" | "Rejected">().notNull().default("Pending"),
  ceoApprovedBy: text("ceo_approved_by"),
  ceoApprovedAt: timestamp("ceo_approved_at", { withTimezone: true }),
  cfoApprovedBy: text("cfo_approved_by"),
  cfoApprovedAt: timestamp("cfo_approved_at", { withTimezone: true }),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  completedTransferId: text("completed_transfer_id").references(() => shareTransfersTable.id),
  recipientCertificateId: text("recipient_certificate_id").references(() => certificatesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("request_status_valid", sql`${t.status} IN ('Pending', 'Completed', 'Rejected')`),
  check("request_kind_valid", sql`${t.kind} IN ('Transfer', 'Issuance')`),
  check("request_payload_matches_kind", sql`(${t.kind} = 'Transfer' AND ${t.sourceCertificateId} IS NOT NULL AND ${t.issuance} IS NULL) OR (${t.kind} = 'Issuance' AND ${t.sourceCertificateId} IS NULL AND ${t.issuance} IS NOT NULL)`),
  check("request_separate_signers", sql`${t.ceoApprovedBy} IS NULL OR ${t.cfoApprovedBy} IS NULL OR ${t.ceoApprovedBy} <> ${t.cfoApprovedBy}`),
  index("request_originator_index").on(t.originatorId),
  index("request_recipient_index").on(t.recipientId),
]);
export const insertTransferRequestSchema = createInsertSchema(transferRequestsTable);
export type TransferRequestRow = typeof transferRequestsTable.$inferSelect;
