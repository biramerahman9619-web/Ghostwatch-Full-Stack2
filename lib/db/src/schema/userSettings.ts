import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userSettingsTable = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().default(""),
  preferredSports: text("preferred_sports").notNull().default("NBA,NFL"),
  riskProfile: text("risk_profile").notNull().default("Balanced"),
  picksPerTicket: text("picks_per_ticket").notNull().default("3"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettingsRow = typeof userSettingsTable.$inferSelect;
