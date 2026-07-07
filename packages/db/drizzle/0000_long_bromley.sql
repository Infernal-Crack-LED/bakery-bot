CREATE TABLE IF NOT EXISTS "guild_config" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"mod_log_channel_id" text,
	"welcome_channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mod_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"moderator_id" text NOT NULL,
	"reason" text,
	"metadata" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nikke_characters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rarity" text,
	"element" text,
	"char_class" text,
	"burst" text,
	"weapon" text,
	"prydwen_slug" text,
	"prydwen_url" text,
	"synergy_id" integer,
	"synergy_url" text,
	"prydwen_tiers" jsonb,
	"synergy_stats" jsonb,
	"sheet_data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nikke_name_dictionary" (
	"source_key" text PRIMARY KEY NOT NULL,
	"english" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nikke_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"sources" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"moderator_id" text NOT NULL,
	"reason" text DEFAULT 'No reason provided' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mod_actions_guild_idx" ON "mod_actions" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warnings_guild_user_idx" ON "warnings" USING btree ("guild_id","user_id");