CREATE TYPE "public"."github_actor_type" AS ENUM('user', 'bot', 'organization', 'mannequin');--> statement-breakpoint
CREATE TYPE "public"."github_webhook_delivery_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."pull_request_provider" AS ENUM('tessera', 'github');--> statement-breakpoint
CREATE TYPE "public"."github_installation_target_type" AS ENUM('user', 'organization');--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'synchronized';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'retargeted';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'converted_to_draft';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'ready_for_review';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'assigned';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'review_requested';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'labeled';--> statement-breakpoint
ALTER TYPE "public"."repository_external_source_sync_status" ADD VALUE 'blocked';--> statement-breakpoint
CREATE TABLE "github_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint,
	"login" text NOT NULL,
	"type" "github_actor_type" NOT NULL,
	"avatar_url" text,
	"html_url" text,
	"user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_actors_external_node_id_unique" UNIQUE("external_node_id")
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_event_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"delivery_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_event_mappings_pull_request_event_id_unique" UNIQUE("pull_request_event_id"),
	CONSTRAINT "github_pull_request_event_mappings_external_key_unique" UNIQUE("external_key")
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"external_node_id" text NOT NULL,
	"external_numeric_id" bigint NOT NULL,
	"external_number" integer NOT NULL,
	"html_url" text NOT NULL,
	"author_actor_id" uuid NOT NULL,
	"merged_by_actor_id" uuid,
	"head_repository_node_id" text,
	"base_repository_node_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"provider_closed_at" timestamp,
	"provider_merged_at" timestamp,
	"last_synced_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_mappings_pull_request_id_unique" UNIQUE("pull_request_id"),
	CONSTRAINT "github_pull_request_mappings_external_node_id_unique" UNIQUE("external_node_id"),
	CONSTRAINT "github_pull_request_mappings_repository_number_unique" UNIQUE("repository_id","external_number"),
	CONSTRAINT "github_pull_request_mappings_repository_numeric_id_unique" UNIQUE("repository_id","external_numeric_id")
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository_id" uuid,
	"installation_id" uuid,
	"event_name" text NOT NULL,
	"action" text,
	"external_repository_node_id" text,
	"external_repository_numeric_id" bigint,
	"subject_node_id" text,
	"subject_number" integer,
	"sender_actor_id" uuid,
	"target_actor_id" uuid,
	"label_node_id" text,
	"label_name" text,
	"sync_version" bigint,
	"status" "github_webhook_delivery_status" DEFAULT 'received' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_installation_id" bigint NOT NULL,
	"account_node_id" text NOT NULL,
	"account_login" text NOT NULL,
	"target_type" "github_installation_target_type" NOT NULL,
	"suspended_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_external_installation_id_unique" UNIQUE("external_installation_id")
);
--> statement-breakpoint
ALTER TABLE "pull_requests" DROP CONSTRAINT "pull_requests_lifecycle_state_check";--> statement-breakpoint
DROP INDEX "pull_requests_open_branch_pair_unique";--> statement-breakpoint
ALTER TABLE "pull_request_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_requests" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD COLUMN "provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "provider" "pull_request_provider" DEFAULT 'tessera' NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "installation_id" uuid;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "external_repository_node_id" text;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "sync_failure_code" text;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "authority_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "requested_sync_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "completed_sync_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "pull_request_sync_cursor_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "sync_lease_owner" text;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "sync_lease_acquired_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "sync_lease_expires_at" timestamp;--> statement-breakpoint
UPDATE "repository_external_sources"
SET
	"sync_status" = 'failed',
	"sync_failure_code" = 'missing_installation',
	"sync_failure_reason" = 'Install the Tessera GitHub App to resume synchronization.',
	"next_sync_at" = NULL
WHERE
	"provider" = 'github'
	AND "mirror_mode" = 'github_to_tessera'
	AND "installation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "github_actors" ADD CONSTRAINT "github_actors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_event_mappings" ADD CONSTRAINT "github_pull_request_event_mappings_pull_request_event_id_pull_request_events_id_fk" FOREIGN KEY ("pull_request_event_id") REFERENCES "public"."pull_request_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_event_mappings" ADD CONSTRAINT "github_pull_request_event_mappings_actor_id_github_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_event_mappings" ADD CONSTRAINT "github_pull_request_event_mappings_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD CONSTRAINT "github_pull_request_mappings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD CONSTRAINT "github_pull_request_mappings_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD CONSTRAINT "github_pull_request_mappings_author_actor_id_github_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_request_mappings" ADD CONSTRAINT "github_pull_request_mappings_merged_by_actor_id_github_actors_id_fk" FOREIGN KEY ("merged_by_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_sender_actor_id_github_actors_id_fk" FOREIGN KEY ("sender_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_target_actor_id_github_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."github_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_actors_external_numeric_id_unique" ON "github_actors" USING btree ("external_numeric_id") WHERE "github_actors"."external_numeric_id" is not null;--> statement-breakpoint
CREATE INDEX "github_actors_user_id_idx" ON "github_actors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_event_mappings_actor_id_idx" ON "github_pull_request_event_mappings" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "github_pull_request_mappings_author_actor_id_idx" ON "github_pull_request_mappings" USING btree ("author_actor_id");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_repository_received_at_idx" ON "github_webhook_deliveries" USING btree ("repository_id","received_at");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_installation_id_idx" ON "github_webhook_deliveries" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_target_actor_id_idx" ON "github_webhook_deliveries" USING btree ("target_actor_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_node_id_idx" ON "github_installations" USING btree ("account_node_id");--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_external_sources_provider_node_id_unique" ON "repository_external_sources" USING btree ("provider","external_repository_node_id") WHERE "repository_external_sources"."external_repository_node_id" is not null;--> statement-breakpoint
CREATE INDEX "repository_external_sources_installation_id_idx" ON "repository_external_sources" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_open_branch_pair_unique" ON "pull_requests" USING btree ("repository_id","source_branch","target_branch") WHERE "pull_requests"."state" = 'open' and "pull_requests"."provider" = 'tessera';--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD CONSTRAINT "pull_request_events_actor_check" CHECK ("pull_request_events"."provider"::text = 'github' or "pull_request_events"."actor_user_id" is not null);--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_author_check" CHECK ("pull_requests"."provider"::text = 'github' or "pull_requests"."author_user_id" is not null);--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_lifecycle_state_check" CHECK ((
				("pull_requests"."state"::text = 'open' and "pull_requests"."closed_at" is null and "pull_requests"."merged_at" is null and "pull_requests"."merge_commit_sha" is null and "pull_requests"."merge_actor_user_id" is null)
				or ("pull_requests"."state"::text = 'closed' and "pull_requests"."closed_at" is not null and "pull_requests"."merged_at" is null and "pull_requests"."merge_commit_sha" is null and "pull_requests"."merge_actor_user_id" is null)
				or ("pull_requests"."state"::text = 'merged' and "pull_requests"."closed_at" is not null and "pull_requests"."merged_at" is not null and "pull_requests"."merge_commit_sha" is not null and ("pull_requests"."provider"::text = 'github' or "pull_requests"."merge_actor_user_id" is not null))
			));--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_sync_versions_check" CHECK ("repository_external_sources"."requested_sync_version" >= 0 and "repository_external_sources"."completed_sync_version" >= 0 and "repository_external_sources"."completed_sync_version" <= "repository_external_sources"."requested_sync_version");--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_authority_generation_check" CHECK ("repository_external_sources"."authority_generation" > 0);--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_sync_lease_check" CHECK ((
				("repository_external_sources"."sync_lease_owner" is null and "repository_external_sources"."sync_lease_acquired_at" is null and "repository_external_sources"."sync_lease_expires_at" is null)
				or ("repository_external_sources"."sync_lease_owner" is not null and "repository_external_sources"."sync_lease_acquired_at" is not null and "repository_external_sources"."sync_lease_expires_at" is not null and "repository_external_sources"."sync_lease_expires_at" > "repository_external_sources"."sync_lease_acquired_at")
			));
