CREATE TABLE IF NOT EXISTS "user_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_teams_discord_id_idx" ON "user_teams" USING btree ("discord_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_teams_discord_id_name_uq" ON "user_teams" USING btree ("discord_id","name");