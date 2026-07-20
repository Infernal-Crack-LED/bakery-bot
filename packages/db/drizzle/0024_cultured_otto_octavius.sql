CREATE TABLE IF NOT EXISTS "news_timestamp_replies" (
	"message_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
