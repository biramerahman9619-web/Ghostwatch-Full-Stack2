import { pgTable, serial, text, boolean, integer, real, timestamp } from "drizzle-orm/pg-core";

export const ghostspereAgentConfig = pgTable("ghostspere_agent_config", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  /** UTC hour (0-23) when the daily scheduled dispatch fires */
  scheduleHour: integer("schedule_hour").notNull().default(8),
  /** Minimum AI confidence score (0-100) for a ticket to be auto-dispatched */
  confidenceThreshold: real("confidence_threshold").notNull().default(75),
  signalWatchEnabled: boolean("signal_watch_enabled").notNull().default(true),
  maxPerDay: integer("max_per_day").notNull().default(3),
  lastDispatchedAt: timestamp("last_dispatched_at", { withTimezone: true }),
  /**
   * Persistent signal dispatch timestamp.  Set to NOW() atomically by
   * atomicClaimSignalAndReserveSlot() BEFORE any evaluation or email send.
   * Enforces the 60-minute signal cooldown even across server restarts.
   * Do not update this outside of that function.
   */
  lastSignalDispatchAt: timestamp("last_signal_dispatch_at", { withTimezone: true }),
  /**
   * Atomic daily dispatch counter.  dailyDate tracks which UTC date dailyUsed applies to;
   * both columns are updated in a single atomic UPDATE so they are always consistent.
   * Do not modify these outside of atomicReserveDailySlot / atomicClaimSignalAndReserveSlot.
   */
  dailyUsed: integer("daily_used").notNull().default(0),
  dailyDate: text("daily_date"),          // "YYYY-MM-DD" UTC
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ghostspereAgentLog = pgTable("ghostspere_agent_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** scheduled_dispatch | signal_dispatch | chat_dispatch | skipped | evaluation */
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  /** JSON array of ticket IDs that were dispatched */
  ticketIds: text("ticket_ids"),
  /** AI summary of why these tickets were selected */
  aiReasoning: text("ai_reasoning"),
  dispatchCount: integer("dispatch_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GhostspereAgentConfig = typeof ghostspereAgentConfig.$inferSelect;
export type InsertGhostspereAgentConfig = typeof ghostspereAgentConfig.$inferInsert;
export type GhostspereAgentLogEntry = typeof ghostspereAgentLog.$inferSelect;
export type InsertGhostspereAgentLog = typeof ghostspereAgentLog.$inferInsert;
