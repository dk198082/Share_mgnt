import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { certificatesTable } from "./certificates";
import { certificateTemplatesTable } from "./certificate-templates";
import { transferRequestsTable } from "./transfer-requests";

export const certificateDocumentsTable = pgTable("certificate_documents", {
  id: text("id").primaryKey(),
  certificateId: text("certificate_id").notNull().references(() => certificatesTable.id, { onDelete: "restrict" }),
  requestId: text("request_id").notNull().references(() => transferRequestsTable.id, { onDelete: "restrict" }),
  templateId: text("template_id").notNull().references(() => certificateTemplatesTable.id, { onDelete: "restrict" }),
  shareholderId: text("shareholder_id").notNull(),
  originatorId: text("originator_id"),
  transferId: text("transfer_id"),
  objectPath: text("object_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("one_pdf_per_certificate").on(t.certificateId),
  uniqueIndex("one_pdf_per_request").on(t.requestId),
  index("certificate_pdf_holder_index").on(t.shareholderId),
  index("certificate_pdf_originator_index").on(t.originatorId),
]);
export const insertCertificateDocumentSchema = createInsertSchema(certificateDocumentsTable);
export type CertificateDocumentRow = typeof certificateDocumentsTable.$inferSelect;
