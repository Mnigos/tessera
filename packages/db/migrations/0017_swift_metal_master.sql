CREATE TYPE "public"."github_pull_request_comment_kind" AS ENUM('issue', 'review');--> statement-breakpoint
CREATE TYPE "public"."github_pull_request_comment_subject_type" AS ENUM('line', 'file');--> statement-breakpoint
CREATE TYPE "public"."github_pull_request_reviewer_target_kind" AS ENUM('user', 'team');--> statement-breakpoint
ALTER TYPE "public"."pull_request_review_state" ADD VALUE 'dismissed';--> statement-breakpoint
CREATE TABLE "github_pull_request_comment_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_mapping_id" uuid NOT NULL,
	"thread_mapping_id" uuid,
	"pull_request_comment_id" uuid,
	"kind" "github_pull_request_comment_kind" NOT NULL,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"author_actor_id" uuid NOT NULL,
	"parent_external_node_id" text,
	"parent_external_numeric_id" bigint,
	"review_external_node_id" text,
	"review_external_numeric_id" bigint,
	"html_url" text NOT NULL,
	"subject_type" "github_pull_request_comment_subject_type",
	"path" text,
	"side" "pull_request_thread_side",
	"line" integer,
	"original_line" integer,
	"start_side" "pull_request_thread_side",
	"start_line" integer,
	"original_start_line" integer,
	"commit_id" text,
	"original_commit_id" text,
	"diff_hunk" text,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"provider_deleted_at" timestamp,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_comment_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_pull_request_comment_mappings_numeric_id_unique" UNIQUE("kind","external_numeric_id")
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_review_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_mapping_id" uuid NOT NULL,
	"pull_request_review_id" uuid,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"reviewer_actor_id" uuid NOT NULL,
	"html_url" text NOT NULL,
	"commit_id" text,
	"dismissed_by_actor_id" uuid,
	"provider_submitted_at" timestamp NOT NULL,
	"provider_dismissed_at" timestamp,
	"provider_deleted_at" timestamp,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_review_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_pull_request_review_mappings_external_numeric_id_unique" UNIQUE("external_numeric_id"),
	CONSTRAINT "github_pull_request_review_mappings_dismissal_check" CHECK ("github_pull_request_review_mappings"."provider_dismissed_at" is not null or "github_pull_request_review_mappings"."dismissed_by_actor_id" is null)
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_reviewer_request_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_mapping_id" uuid NOT NULL,
	"pull_request_reviewer_request_id" uuid,
	"external_key" text NOT NULL,
	"target_kind" "github_pull_request_reviewer_target_kind" NOT NULL,
	"target_node_id" text NOT NULL,
	"target_numeric_id" bigint,
	"target_actor_id" uuid,
	"team_slug" text,
	"team_name" text,
	"team_avatar_url" text,
	"team_html_url" text,
	"requested_by_actor_id" uuid,
	"removed_by_actor_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_reviewer_request_external_key_unique" UNIQUE("external_key"),
	CONSTRAINT "github_pull_request_reviewer_request_target_check" CHECK ((
				("github_pull_request_reviewer_request_mappings"."target_kind"::text = 'user' and "github_pull_request_reviewer_request_mappings"."target_actor_id" is not null and "github_pull_request_reviewer_request_mappings"."team_slug" is null)
				or ("github_pull_request_reviewer_request_mappings"."target_kind"::text = 'team' and "github_pull_request_reviewer_request_mappings"."target_actor_id" is null and "github_pull_request_reviewer_request_mappings"."team_slug" is not null)
			))
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_thread_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_mapping_id" uuid NOT NULL,
	"pull_request_thread_id" uuid,
	"external_node_id" text,
	"root_comment_node_id" text,
	"resolved_by_actor_id" uuid,
	"provider_resolved" boolean DEFAULT false NOT NULL,
	"provider_resolved_at" timestamp,
	"provider_outdated" boolean DEFAULT false NOT NULL,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_thread_mappings_identity_check" CHECK ("github_pull_request_thread_mappings"."external_node_id" is not null or "github_pull_request_thread_mappings"."root_comment_node_id" is not null),
	CONSTRAINT "github_pull_request_thread_mappings_resolution_check" CHECK (("github_pull_request_thread_mappings"."provider_resolved" = false) = ("github_pull_request_thread_mappings"."provider_resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "pull_request_reviews" DROP CONSTRAINT "pull_request_reviews_state_check";--> statement-breakpoint
ALTER TABLE "pull_request_threads" DROP CONSTRAINT "pull_request_threads_resolution_check";--> statement-breakpoint
ALTER TABLE "pull_request_comments" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD COLUMN "dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD COLUMN "dismissed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD COLUMN "provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD COLUMN "provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_pull_request_comment_mappings" ADD CONSTRAINT "github_pull_request_comment_mappings_pull_request_mapping_id_github_pull_request_mappings_id_fk" FOREIGN KEY ("pull_request_mapping_id") REFERENCES "public"."github_pull_request_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_comment_mappings" ADD CONSTRAINT "github_pull_request_comment_mappings_thread_mapping_id_github_pull_request_thread_mappings_id_fk" FOREIGN KEY ("thread_mapping_id") REFERENCES "public"."github_pull_request_thread_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_comment_mappings" ADD CONSTRAINT "github_pull_request_comment_mappings_pull_request_comment_id_pull_request_comments_id_fk" FOREIGN KEY ("pull_request_comment_id") REFERENCES "public"."pull_request_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_comment_mappings" ADD CONSTRAINT "github_pull_request_comment_mappings_author_actor_id_github_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_comment_mappings" ADD CONSTRAINT "github_pull_request_comment_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_review_mappings" ADD CONSTRAINT "github_pull_request_review_mappings_pull_request_mapping_id_github_pull_request_mappings_id_fk" FOREIGN KEY ("pull_request_mapping_id") REFERENCES "public"."github_pull_request_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_review_mappings" ADD CONSTRAINT "github_pull_request_review_mappings_pull_request_review_id_pull_request_reviews_id_fk" FOREIGN KEY ("pull_request_review_id") REFERENCES "public"."pull_request_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_review_mappings" ADD CONSTRAINT "github_pull_request_review_mappings_reviewer_actor_id_github_actors_id_fk" FOREIGN KEY ("reviewer_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_review_mappings" ADD CONSTRAINT "github_pull_request_review_mappings_dismissed_by_actor_id_github_actors_id_fk" FOREIGN KEY ("dismissed_by_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_review_mappings" ADD CONSTRAINT "github_pull_request_review_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_pull_request_mapping_id_github_pull_request_mappings_id_fk" FOREIGN KEY ("pull_request_mapping_id") REFERENCES "public"."github_pull_request_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_pull_request_reviewer_request_id_pull_request_reviewer_requests_id_fk" FOREIGN KEY ("pull_request_reviewer_request_id") REFERENCES "public"."pull_request_reviewer_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_target_actor_id_github_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_requested_by_actor_id_github_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_removed_by_actor_id_github_actors_id_fk" FOREIGN KEY ("removed_by_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_reviewer_request_mappings" ADD CONSTRAINT "github_pull_request_reviewer_request_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_thread_mappings" ADD CONSTRAINT "github_pull_request_thread_mappings_pull_request_mapping_id_github_pull_request_mappings_id_fk" FOREIGN KEY ("pull_request_mapping_id") REFERENCES "public"."github_pull_request_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_thread_mappings" ADD CONSTRAINT "github_pull_request_thread_mappings_pull_request_thread_id_pull_request_threads_id_fk" FOREIGN KEY ("pull_request_thread_id") REFERENCES "public"."pull_request_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_thread_mappings" ADD CONSTRAINT "github_pull_request_thread_mappings_resolved_by_actor_id_github_actors_id_fk" FOREIGN KEY ("resolved_by_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_thread_mappings" ADD CONSTRAINT "github_pull_request_thread_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_comment_mappings_comment_id_unique" ON "github_pull_request_comment_mappings" USING btree ("pull_request_comment_id") WHERE "github_pull_request_comment_mappings"."pull_request_comment_id" is not null;--> statement-breakpoint
CREATE INDEX "github_pull_request_comment_mappings_pull_request_mapping_idx" ON "github_pull_request_comment_mappings" USING btree ("pull_request_mapping_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_comment_mappings_thread_mapping_idx" ON "github_pull_request_comment_mappings" USING btree ("thread_mapping_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_comment_mappings_author_actor_idx" ON "github_pull_request_comment_mappings" USING btree ("author_actor_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_comment_mappings_parent_node_id_idx" ON "github_pull_request_comment_mappings" USING btree ("parent_external_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_review_mappings_review_id_unique" ON "github_pull_request_review_mappings" USING btree ("pull_request_review_id") WHERE "github_pull_request_review_mappings"."pull_request_review_id" is not null;--> statement-breakpoint
CREATE INDEX "github_pull_request_review_mappings_pull_request_mapping_idx" ON "github_pull_request_review_mappings" USING btree ("pull_request_mapping_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_review_mappings_reviewer_actor_idx" ON "github_pull_request_review_mappings" USING btree ("reviewer_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_reviewer_request_active_target_unique" ON "github_pull_request_reviewer_request_mappings" USING btree ("pull_request_mapping_id","target_kind","target_node_id") WHERE "github_pull_request_reviewer_request_mappings"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_reviewer_request_request_id_unique" ON "github_pull_request_reviewer_request_mappings" USING btree ("pull_request_reviewer_request_id") WHERE "github_pull_request_reviewer_request_mappings"."pull_request_reviewer_request_id" is not null;--> statement-breakpoint
CREATE INDEX "github_pull_request_reviewer_request_mapping_idx" ON "github_pull_request_reviewer_request_mappings" USING btree ("pull_request_mapping_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_reviewer_request_target_actor_idx" ON "github_pull_request_reviewer_request_mappings" USING btree ("target_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_thread_mappings_node_id_unique" ON "github_pull_request_thread_mappings" USING btree ("external_node_id") WHERE "github_pull_request_thread_mappings"."external_node_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_thread_mappings_root_comment_unique" ON "github_pull_request_thread_mappings" USING btree ("root_comment_node_id") WHERE "github_pull_request_thread_mappings"."root_comment_node_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "github_pull_request_thread_mappings_thread_id_unique" ON "github_pull_request_thread_mappings" USING btree ("pull_request_thread_id") WHERE "github_pull_request_thread_mappings"."pull_request_thread_id" is not null;--> statement-breakpoint
CREATE INDEX "github_pull_request_thread_mappings_pull_request_mapping_idx" ON "github_pull_request_thread_mappings" USING btree ("pull_request_mapping_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_thread_mappings_resolved_by_actor_idx" ON "github_pull_request_thread_mappings" USING btree ("resolved_by_actor_id");--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_dismissed_by_user_id_user_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_state_check" CHECK ((
				("pull_request_reviews"."state"::text = 'pending' and "pull_request_reviews"."outcome" is null and "pull_request_reviews"."submitted_at" is null and "pull_request_reviews"."dismissed_at" is null and "pull_request_reviews"."dismissed_by_user_id" is null)
				or ("pull_request_reviews"."state"::text = 'submitted' and "pull_request_reviews"."outcome" is not null and "pull_request_reviews"."submitted_at" is not null and "pull_request_reviews"."dismissed_at" is null and "pull_request_reviews"."dismissed_by_user_id" is null)
				or ("pull_request_reviews"."state"::text = 'dismissed' and "pull_request_reviews"."outcome" is not null and "pull_request_reviews"."submitted_at" is not null and "pull_request_reviews"."dismissed_at" is not null and ("pull_request_reviews"."provider"::text = 'github' or "pull_request_reviews"."dismissed_by_user_id" is not null))
			));--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD CONSTRAINT "pull_request_comments_author_check" CHECK ("pull_request_comments"."provider"::text = 'github' or "pull_request_comments"."author_user_id" is not null);--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD CONSTRAINT "pull_request_threads_resolution_check" CHECK ((
				("pull_request_threads"."resolved_at" is null and "pull_request_threads"."resolved_by_user_id" is null)
				or ("pull_request_threads"."resolved_at" is not null and ("pull_request_threads"."provider"::text = 'github' or "pull_request_threads"."resolved_by_user_id" is not null))
			));