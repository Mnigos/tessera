ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'review_dismissed';--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD COLUMN "conversation_synced_at" timestamp;--> statement-breakpoint
CREATE INDEX "github_pull_request_mappings_conversation_synced_at_idx" ON "github_pull_request_mappings" USING btree ("repository_id","conversation_synced_at");