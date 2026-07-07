CREATE TABLE IF NOT EXISTS "feature_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text,
	"user_id" text NOT NULL,
	"user_tag" text,
	"content" text NOT NULL,
	"github_issue_url" text,
	"github_issue_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
