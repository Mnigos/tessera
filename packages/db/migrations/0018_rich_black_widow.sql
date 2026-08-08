CREATE TYPE "public"."check_kind" AS ENUM('status', 'check_run');--> statement-breakpoint
CREATE TYPE "public"."check_state" AS ENUM('queued', 'pending', 'success', 'failure', 'neutral', 'canceled', 'skipped', 'timed_out', 'stale');--> statement-breakpoint
ALTER TYPE "public"."github_webhook_target_resource_kind" ADD VALUE 'check_suite';--> statement-breakpoint
ALTER TYPE "public"."github_webhook_target_resource_kind" ADD VALUE 'check_run';--> statement-breakpoint
ALTER TYPE "public"."github_webhook_target_resource_kind" ADD VALUE 'commit_status';--> statement-breakpoint
CREATE TABLE "check_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"state" "check_state" NOT NULL,
	"raw_status" text,
	"raw_conclusion" text,
	"target_url" text,
	"description" text,
	"output_title" text,
	"output_summary" text,
	"credential_id" uuid,
	"provider_created_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"sync_version" bigint,
	"delivery_id" uuid,
	"fingerprint" text NOT NULL,
	CONSTRAINT "check_observations_check_fingerprint_unique" UNIQUE("check_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"kind" "check_kind" NOT NULL,
	"context" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_check_run_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"check_suite_mapping_id" uuid,
	"check_id" uuid,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"name" text NOT NULL,
	"head_sha" text NOT NULL,
	"external_id" text,
	"details_url" text,
	"html_url" text,
	"app_external_numeric_id" bigint,
	"app_external_node_id" text,
	"app_slug" text,
	"app_name" text,
	"app_html_url" text,
	"provider_started_at" timestamp,
	"provider_completed_at" timestamp,
	"provider_missing_at" timestamp,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_check_run_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_check_run_mappings_external_numeric_id_unique" UNIQUE("external_numeric_id")
);
--> statement-breakpoint
CREATE TABLE "github_check_suite_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"head_sha" text NOT NULL,
	"raw_status" text,
	"raw_conclusion" text,
	"app_external_numeric_id" bigint,
	"app_external_node_id" text,
	"app_slug" text,
	"app_name" text,
	"app_html_url" text,
	"provider_created_at" timestamp,
	"provider_updated_at" timestamp,
	"provider_missing_at" timestamp,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_check_suite_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_check_suite_mappings_external_numeric_id_unique" UNIQUE("external_numeric_id")
);
--> statement-breakpoint
CREATE TABLE "github_commit_status_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"check_id" uuid,
	"check_observation_id" uuid,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"sha" text NOT NULL,
	"context" text NOT NULL,
	"raw_state" text NOT NULL,
	"target_url" text,
	"description" text,
	"creator_actor_id" uuid,
	"provider_created_at" timestamp,
	"provider_updated_at" timestamp,
	"provider_missing_at" timestamp,
	"delivery_id" uuid,
	"last_seen_sync_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_commit_status_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_commit_status_mappings_external_numeric_id_unique" UNIQUE("external_numeric_id")
);
--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD COLUMN "checks_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_sha" text;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_context" text;--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_run_mappings" ADD CONSTRAINT "github_check_run_mappings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_run_mappings" ADD CONSTRAINT "github_check_run_mappings_check_suite_mapping_id_github_check_suite_mappings_id_fk" FOREIGN KEY ("check_suite_mapping_id") REFERENCES "public"."github_check_suite_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_run_mappings" ADD CONSTRAINT "github_check_run_mappings_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_run_mappings" ADD CONSTRAINT "github_check_run_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_suite_mappings" ADD CONSTRAINT "github_check_suite_mappings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_check_suite_mappings" ADD CONSTRAINT "github_check_suite_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit_status_mappings" ADD CONSTRAINT "github_commit_status_mappings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit_status_mappings" ADD CONSTRAINT "github_commit_status_mappings_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit_status_mappings" ADD CONSTRAINT "github_commit_status_mappings_check_observation_id_check_observations_id_fk" FOREIGN KEY ("check_observation_id") REFERENCES "public"."check_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit_status_mappings" ADD CONSTRAINT "github_commit_status_mappings_creator_actor_id_github_actors_id_fk" FOREIGN KEY ("creator_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_commit_status_mappings" ADD CONSTRAINT "github_commit_status_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_observations_check_id_recency_idx" ON "check_observations" USING btree ("check_id","observed_at" DESC NULLS LAST,"sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checks_repository_sha_context_kind_idx" ON "checks" USING btree ("repository_id","sha","context","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_status_stream_unique" ON "checks" USING btree ("repository_id","sha","context") WHERE "checks"."kind" = 'status';--> statement-breakpoint
CREATE UNIQUE INDEX "github_check_run_mappings_check_id_unique" ON "github_check_run_mappings" USING btree ("check_id") WHERE "github_check_run_mappings"."check_id" is not null;--> statement-breakpoint
CREATE INDEX "github_check_run_mappings_repository_head_sha_idx" ON "github_check_run_mappings" USING btree ("repository_id","head_sha");--> statement-breakpoint
CREATE INDEX "github_check_run_mappings_check_suite_mapping_idx" ON "github_check_run_mappings" USING btree ("check_suite_mapping_id");--> statement-breakpoint
CREATE INDEX "github_check_suite_mappings_repository_head_sha_idx" ON "github_check_suite_mappings" USING btree ("repository_id","head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "github_commit_status_mappings_observation_id_unique" ON "github_commit_status_mappings" USING btree ("check_observation_id") WHERE "github_commit_status_mappings"."check_observation_id" is not null;--> statement-breakpoint
CREATE INDEX "github_commit_status_mappings_repository_sha_context_idx" ON "github_commit_status_mappings" USING btree ("repository_id","sha","context");--> statement-breakpoint
CREATE INDEX "github_commit_status_mappings_creator_actor_idx" ON "github_commit_status_mappings" USING btree ("creator_actor_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_mappings_checks_synced_at_idx" ON "github_pull_request_mappings" USING btree ("repository_id","checks_synced_at" NULLS FIRST,"external_number") WHERE "github_pull_request_mappings"."provider_closed_at" is null;