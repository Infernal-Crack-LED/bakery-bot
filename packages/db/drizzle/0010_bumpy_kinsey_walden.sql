CREATE TABLE IF NOT EXISTS "commands_only_guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_nudged_at" timestamp with time zone
);
