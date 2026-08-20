ALTER TABLE "github_pull_request_mappings" ADD COLUMN IF NOT EXISTS "labels" jsonb;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD COLUMN IF NOT EXISTS "assignees" jsonb;