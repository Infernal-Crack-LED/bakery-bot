CREATE TABLE IF NOT EXISTS "nikke_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"open_id" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nikke_account_links_discord_id_idx" ON "nikke_account_links" USING btree ("discord_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nikke_account_links_discord_open_uq" ON "nikke_account_links" USING btree ("discord_id","open_id");