CREATE TYPE "public"."pull_request_review_outcome" AS ENUM('approve', 'request_changes', 'comment');--> statement-breakpoint
CREATE TYPE "public"."pull_request_review_state" AS ENUM('pending', 'submitted');--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'review_request_removed';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'review_submitted';--> statement-breakpoint
CREATE TABLE "pull_request_reviewer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL,
	"reviewer_user_id" uuid,
	"requested_by_user_id" uuid,
	"fulfilled_by_review_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"removed_at" timestamp,
	"removed_by_user_id" uuid,
	CONSTRAINT "pull_request_reviewer_requests_actors_check" CHECK ("pull_request_reviewer_requests"."provider"::text = 'github' or ("pull_request_reviewer_requests"."reviewer_user_id" is not null and "pull_request_reviewer_requests"."requested_by_user_id" is not null)),
	CONSTRAINT "pull_request_reviewer_requests_removal_check" CHECK ((
				("pull_request_reviewer_requests"."removed_at" is null and "pull_request_reviewer_requests"."removed_by_user_id" is null)
				or ("pull_request_reviewer_requests"."removed_at" is not null and ("pull_request_reviewer_requests"."provider"::text = 'github' or "pull_request_reviewer_requests"."removed_by_user_id" is not null))
			))
);
--> statement-breakpoint
CREATE TABLE "pull_request_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL,
	"reviewer_user_id" uuid,
	"state" "pull_request_review_state" DEFAULT 'pending' NOT NULL,
	"outcome" "pull_request_review_outcome",
	"head_sha" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	CONSTRAINT "pull_request_reviews_reviewer_check" CHECK ("pull_request_reviews"."provider"::text = 'github' or "pull_request_reviews"."reviewer_user_id" is not null),
	CONSTRAINT "pull_request_reviews_state_check" CHECK ((
				("pull_request_reviews"."state"::text = 'pending' and "pull_request_reviews"."outcome" is null and "pull_request_reviews"."submitted_at" is null)
				or ("pull_request_reviews"."state"::text = 'submitted' and "pull_request_reviews"."outcome" is not null and "pull_request_reviews"."submitted_at" is not null)
			))
);
--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "pull_request_reviewer_requests" ADD CONSTRAINT "pull_request_reviewer_requests_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviewer_requests" ADD CONSTRAINT "pull_request_reviewer_requests_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviewer_requests" ADD CONSTRAINT "pull_request_reviewer_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviewer_requests" ADD CONSTRAINT "pull_request_reviewer_requests_fulfilled_by_review_id_pull_request_reviews_id_fk" FOREIGN KEY ("fulfilled_by_review_id") REFERENCES "public"."pull_request_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviewer_requests" ADD CONSTRAINT "pull_request_reviewer_requests_removed_by_user_id_user_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_reviewer_requests_active_reviewer_unique" ON "pull_request_reviewer_requests" USING btree ("pull_request_id","reviewer_user_id") WHERE "pull_request_reviewer_requests"."removed_at" is null and "pull_request_reviewer_requests"."fulfilled_by_review_id" is null;--> statement-breakpoint
CREATE INDEX "pull_request_reviewer_requests_pull_request_created_at_idx" ON "pull_request_reviewer_requests" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_reviews_pending_reviewer_unique" ON "pull_request_reviews" USING btree ("pull_request_id","reviewer_user_id") WHERE "pull_request_reviews"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "pull_request_reviews_pull_request_state_idx" ON "pull_request_reviews" USING btree ("pull_request_id","state");--> statement-breakpoint
CREATE INDEX "pull_request_reviews_pull_request_reviewer_submitted_at_idx" ON "pull_request_reviews" USING btree ("pull_request_id","reviewer_user_id","submitted_at");--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD CONSTRAINT "pull_request_comments_review_id_pull_request_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pull_request_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_comments_review_id_idx" ON "pull_request_comments" USING btree ("review_id");--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD CONSTRAINT "pull_request_comments_pending_review_check" CHECK ("pull_request_comments"."state"::text <> 'pending' or "pull_request_comments"."review_id" is not null);