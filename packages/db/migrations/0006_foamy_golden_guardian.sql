CREATE TYPE "public"."repository_import_provider" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."repository_import_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."repository_import_visibility" AS ENUM('public', 'private', 'internal');--> statement-breakpoint
CREATE TABLE "repository_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"repository_id" uuid,
	"provider" "repository_import_provider" DEFAULT 'github' NOT NULL,
	"target_name" text NOT NULL,
	"target_slug" text NOT NULL,
	"source_github_id" bigint NOT NULL,
	"source_owner_login" text NOT NULL,
	"source_name" text NOT NULL,
	"source_full_name" text NOT NULL,
	"source_visibility" "repository_import_visibility" DEFAULT 'private' NOT NULL,
	"source_default_branch" text NOT NULL,
	"source_github_url" text NOT NULL,
	"status" "repository_import_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_imports" ADD CONSTRAINT "repository_imports_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_imports" ADD CONSTRAINT "repository_imports_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_imports_owner_user_id_idx" ON "repository_imports" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "repository_imports_repository_id_idx" ON "repository_imports" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "repository_imports_status_idx" ON "repository_imports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_imports_active_source_unique" ON "repository_imports" USING btree ("owner_user_id","source_github_id") WHERE "repository_imports"."status" != 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "repository_imports_active_target_slug_unique" ON "repository_imports" USING btree ("owner_user_id","target_slug") WHERE "repository_imports"."status" != 'failed';