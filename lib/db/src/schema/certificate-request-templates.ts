import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { transferRequestsTable } from "./transfer-requests";
import { certificateTemplatesTable } from "./certificate-templates";

export const certificateRequestTemplatesTable = pgTable("certificate_request_templates", {
  requestId: text("request_id").primaryKey().references(() => transferRequestsTable.id, { onDelete: "restrict" }),
  templateId: text("template_id").notNull().references(() => certificateTemplatesTable.id, { onDelete: "restrict" }),
});
export const insertCertificateRequestTemplateSchema = createInsertSchema(certificateRequestTemplatesTable);
export type CertificateRequestTemplateRow = typeof certificateRequestTemplatesTable.$inferSelect;
