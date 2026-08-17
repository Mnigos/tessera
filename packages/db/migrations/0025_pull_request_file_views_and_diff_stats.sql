CREATE TABLE "pull_request_file_views" (
	"user_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"path" text NOT NULL,
	"head_sha" text NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_file_views_pkey" PRIMARY KEY("user_id","pull_request_id","path","head_sha")
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_base_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_additions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_deletions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_changed_files" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD CONSTRAINT "pull_request_file_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_file_views" ADD CONSTRAINT "pull_request_file_views_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_file_views_pull_request_user_head_idx" ON "pull_request_file_views" USING btree ("pull_request_id","user_id","head_sha");--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_diff_stats_check" CHECK (num_nulls("pull_requests"."diff_stats_base_sha", "pull_requests"."diff_stats_head_sha", "pull_requests"."diff_additions", "pull_requests"."diff_deletions", "pull_requests"."diff_changed_files", "pull_requests"."diff_stats_updated_at") in (0, 6));