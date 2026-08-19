-- Old rows are per-head; the new per-path key cannot host duplicates.
DELETE FROM "pull_request_file_views";--> statement-breakpoint
DROP INDEX "pull_request_file_views_pull_request_user_head_idx";--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD COLUMN "base_blob_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD COLUMN "head_blob_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "base_blob_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "head_blob_id" text;--> statement-breakpoint
CREATE INDEX "pull_request_file_views_pull_request_user_idx" ON "pull_request_file_views" USING btree ("pull_request_id","user_id");--> statement-breakpoint
ALTER TABLE "pull_request_file_views" DROP CONSTRAINT "pull_request_file_views_pkey";
--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD CONSTRAINT "pull_request_file_views_pkey" PRIMARY KEY("user_id","pull_request_id","path");