-- Migration 0001: Ghostspere autonomous agent tables
-- Adds ghostspere_agent_config and ghostspere_agent_log for the autonomous
-- dispatch agent (Task #44).  All columns include atomic race-control fields
-- (daily_used, daily_date, last_signal_dispatch_at) added in the same migration
-- so there is no intermediate state where the table exists without them.

CREATE TABLE IF NOT EXISTS "ghostspere_agent_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "schedule_hour" integer DEFAULT 8 NOT NULL,
  "confidence_threshold" real DEFAULT 75 NOT NULL,
  "signal_watch_enabled" boolean DEFAULT true NOT NULL,
  "max_per_day" integer DEFAULT 3 NOT NULL,
  "last_dispatched_at" timestamp with time zone,
  "last_signal_dispatch_at" timestamp with time zone,
  "daily_used" integer DEFAULT 0 NOT NULL,
  "daily_date" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ghostspere_agent_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ghostspere_agent_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "ticket_ids" text,
  "ai_reasoning" text,
  "dispatch_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
