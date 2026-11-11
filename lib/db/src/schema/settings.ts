import { pgTable, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Legacy undated values, retained as migration evidence. New prices are appended
// to share_price_history; do not use this row to determine a historical price.
export const companySettingsTable = pgTable("company_settings", {
  id: text("id").primaryKey(),
  commonPrice: numeric("common_price", { precision: 24, scale: 6 }),
  preferredPrice: numeric("preferred_price", { precision: 24, scale: 6 }),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const signoffsTable = pgTable("signoffs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  signaturePath: text("signature_path").notNull(),
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertCompanySettingsSchema = createInsertSchema(companySettingsTable);
export const insertSignoffSchema = createInsertSchema(signoffsTable);
