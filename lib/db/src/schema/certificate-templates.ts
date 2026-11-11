import { pgTable, text, boolean, timestamp, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

export const certificateTemplatesTable = pgTable("certificate_templates", {
  id: text("id").primaryKey(),
  shareClass: text("share_class").$type<"Common" | "Preferred">().notNull(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  fields: jsonb("fields").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("one_active_certificate_template_per_class").on(t.shareClass).where(sql`${t.active} = true`),
  check("certificate_template_class_valid", sql`${t.shareClass} IN ('Common', 'Preferred')`),
]);
export const insertCertificateTemplateSchema = createInsertSchema(certificateTemplatesTable);
export type CertificateTemplateRow = typeof certificateTemplatesTable.$inferSelect;
