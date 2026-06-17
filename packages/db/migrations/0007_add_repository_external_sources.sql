CREATE TYPE "public"."repository_external_source_provider" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."repository_external_source_mirror_mode" AS ENUM('imported', 'github_to_tessera');--> statement-breakpoint
CREATE TYPE "public"."repository_external_source_sync_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "repository_external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"provider" "repository_external_source_provider" DEFAULT 'github' NOT NULL,
	"external_repository_id" bigint NOT NULL,
	"owner_login" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"source_url" text NOT NULL,
	"source_default_branch" text NOT NULL,
	"mirror_mode" "repository_external_source_mirror_mode" DEFAULT 'imported' NOT NULL,
	"sync_status" "repository_external_source_sync_status" DEFAULT 'pending' NOT NULL,
	"last_sync_started_at" timestamp,
	"last_sync_succeeded_at" timestamp,
	"last_sync_failed_at" timestamp,
	"sync_failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repository_external_sources_repository_id_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "repository_external_sources" (
	"repository_id",
	"provider",
	"external_repository_id",
	"owner_login",
	"name",
	"full_name",
	"source_url",
	"source_default_branch",
	"mirror_mode",
	"sync_status",
	"last_sync_started_at",
	"last_sync_succeeded_at",
	"sync_failure_reason",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON ("repository_id")
	"repository_id",
	'github',
	"source_github_id",
	"source_owner_login",
	"source_name",
	"source_full_name",
	"source_github_url",
	"source_default_branch",
	'imported',
	'succeeded',
	coalesce("started_at", "completed_at", "updated_at"),
	coalesce("completed_at", "updated_at"),
	null,
	"updated_at",
	"updated_at"
FROM "repository_imports"
WHERE "status" = 'succeeded'
	AND "repository_id" IS NOT NULL
ORDER BY "repository_id", "completed_at" DESC NULLS LAST, "updated_at" DESC;--> statement-breakpoint
CREATE INDEX "repository_external_sources_provider_external_id_idx" ON "repository_external_sources" USING btree ("provider","external_repository_id");--> statement-breakpoint
CREATE INDEX "repository_external_sources_repository_id_idx" ON "repository_external_sources" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "repository_external_sources_provider_full_name_idx" ON "repository_external_sources" USING btree ("provider","full_name");
