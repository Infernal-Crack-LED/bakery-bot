CREATE TABLE IF NOT EXISTS "nikke_rosters" (
	"open_id" text PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"characters" jsonb NOT NULL,
	"details" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
