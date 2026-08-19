CREATE TYPE "public"."pull_request_review_submission_state" AS ENUM('preparing', 'sent', 'reconciled', 'adopted', 'failed');--> statement-breakpoint
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
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_review_id_pull_request_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pull_request_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_submissions" ADD CONSTRAINT "pull_request_review_submissions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_review_submissions_pull_request_actor_idx" ON "pull_request_review_submissions" USING btree ("pull_request_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_request_review_submissions_review_idx" ON "pull_request_review_submissions" USING btree ("review_id");