ALTER TABLE "github_pull_request_mappings" ADD COLUMN "provider_mergeable_state" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_commit_count" integer;