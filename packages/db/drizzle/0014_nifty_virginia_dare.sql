CREATE TABLE IF NOT EXISTS "nikke_patch_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"tldr" jsonb NOT NULL,
	"diagnostics" jsonb,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nikke_patch_updates_content_id_unique" UNIQUE("content_id")
);
--> statement-breakpoint
DROP TABLE "event_ingest_runs" CASCADE;--> statement-breakpoint
ALTER TABLE "gacha_events" ADD COLUMN "source_content_id" text;--> statement-breakpoint
ALTER TABLE "gacha_events" DROP COLUMN IF EXISTS "source_message_id";--> statement-breakpoint
ALTER TABLE "gacha_events" DROP COLUMN IF EXISTS "source_channel_id";--> statement-breakpoint
ALTER TABLE "gacha_events" DROP COLUMN IF EXISTS "ingest_run_id";--> statement-breakpoint
ALTER TABLE "gacha_events" DROP COLUMN IF EXISTS "approved_by";