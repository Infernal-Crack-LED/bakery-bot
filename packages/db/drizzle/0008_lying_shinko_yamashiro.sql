CREATE TABLE IF NOT EXISTS "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author_tag" text,
	"content" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_config" ADD COLUMN "quote_emoji" text;--> statement-breakpoint
ALTER TABLE "guild_config" ADD COLUMN "quote_threshold" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_guild_user_idx" ON "quotes" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_message_unique" ON "quotes" USING btree ("message_id");