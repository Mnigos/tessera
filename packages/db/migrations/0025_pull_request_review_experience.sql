CREATE TYPE "public"."pull_request_review_submission_state" AS ENUM('preparing', 'sent', 'reconciled', 'adopted', 'failed');--> statement-breakpoint
CREATE TABLE "pull_request_file_views" (
	"user_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"path" text NOT NULL,
	"base_blob_id" text,
	"head_blob_id" text,
	"head_sha" text NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_file_views_pkey" PRIMARY KEY("user_id","pull_request_id","path")
);
--> statement-breakpoint
CREATE TABLE "pull_request_review_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"review_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "pull_request_review_submission_state" DEFAULT 'preparing' NOT NULL,
	"expected_head_sha" text NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"external_review_node_id" text,
	"external_review_numeric_id" bigint,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_review_submissions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "pull_request_threads" DROP CONSTRAINT "pull_request_threads_anchor_check";--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD COLUMN "labels" jsonb;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD COLUMN "assignees" jsonb;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "start_line" integer;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "base_blob_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "head_blob_id" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_base_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_additions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_deletions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_changed_files" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD CONSTRAINT "pull_request_file_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD CONSTRAINT "pull_request_file_views_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_review_id_pull_request_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pull_request_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_file_views_pull_request_user_idx" ON "pull_request_file_views" USING btree ("pull_request_id","user_id");--> statement-breakpoint
CREATE INDEX "pull_request_review_submissions_pull_request_actor_idx" ON "pull_request_review_submissions" USING btree ("pull_request_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_request_review_submissions_review_idx" ON "pull_request_review_submissions" USING btree ("review_id");--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD CONSTRAINT "pull_request_threads_anchor_check" CHECK ((
				("pull_request_threads"."kind"::text = 'top_level' and "pull_request_threads"."path" is null and "pull_request_threads"."side" is null and "pull_request_threads"."start_line" is null and "pull_request_threads"."line" is null and "pull_request_threads"."anchor_sha" is null and "pull_request_threads"."base_sha" is null and "pull_request_threads"."head_sha" is null and "pull_request_threads"."line_excerpt" is null)
				or ("pull_request_threads"."kind"::text = 'inline' and "pull_request_threads"."path" is not null and "pull_request_threads"."side" is not null and "pull_request_threads"."line" is not null and "pull_request_threads"."line" > 0 and ("pull_request_threads"."start_line" is null or ("pull_request_threads"."start_line" > 0 and "pull_request_threads"."start_line" <= "pull_request_threads"."line")) and "pull_request_threads"."anchor_sha" is not null and "pull_request_threads"."base_sha" is not null and "pull_request_threads"."head_sha" is not null and "pull_request_threads"."line_excerpt" is not null)
			));--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_diff_stats_check" CHECK (num_nulls("pull_requests"."diff_stats_base_sha", "pull_requests"."diff_stats_head_sha", "pull_requests"."diff_additions", "pull_requests"."diff_deletions", "pull_requests"."diff_changed_files", "pull_requests"."diff_stats_updated_at") in (0, 6));