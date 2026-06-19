CREATE TYPE "public"."repository_external_source_github_push_back_status" AS ENUM('idle', 'running', 'succeeded', 'failed');--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_status" "repository_external_source_github_push_back_status" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_succeeded_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "github_push_back_failure_reason" text;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_github_push_back_enabled_check" CHECK (("repository_external_sources"."github_push_back_enabled" = false or ("repository_external_sources"."provider"::text = 'github' and "repository_external_sources"."mirror_mode"::text = 'tessera_source')));
