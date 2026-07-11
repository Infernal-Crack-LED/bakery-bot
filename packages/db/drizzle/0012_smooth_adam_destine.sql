CREATE TABLE IF NOT EXISTS "event_ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"source_message_id" text,
	"source_channel_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"trigger" text,
	"proposal" jsonb,
	"diagnostics" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gacha_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"characters" jsonb,
	"notes" text,
	"flags" jsonb,
	"source_message_id" text,
	"source_channel_id" text,
	"ingest_run_id" integer,
	"approved_by" text,
	"start_reminder_sent_at" timestamp with time zone,
	"end_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_ingest_runs_guild_idx" ON "event_ingest_runs" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_ingest_runs_message_idx" ON "event_ingest_runs" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gacha_events_guild_start_idx" ON "gacha_events" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gacha_events_guild_type_name_unique" ON "gacha_events" USING btree ("guild_id","type","name");