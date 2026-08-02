import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pickResultsTable = pgTable("pick_results", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  pickId: text("pick_id").notNull(),
  result: text("result"), // 'hit' | 'miss' | 'push'
  settledAt: timestamp("settled_at").defaultNow(),
  settledValue: text("settled_value"), // actual stat, e.g. "27"
  settledSource: text("settled_source").default("manual"), // 'espn' | 'manual'
});
