CREATE TYPE "public"."branch_protection_bypass_role" AS ENUM('admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."merge_queue_entry_state" AS ENUM('queued', 'validating', 'merging', 'paused', 'removed', 'completed');--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'merge_blocked';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'merge_bypassed';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'queue_entered';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'queue_paused';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'queue_resumed';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'queue_removed';--> statement-breakpoint
ALTER TYPE "public"."repository_event_type" ADD VALUE 'branch_protection_created';--> statement-breakpoint
ALTER TYPE "public"."repository_event_type" ADD VALUE 'branch_protection_updated';--> statement-breakpoint
ALTER TYPE "public"."repository_event_type" ADD VALUE 'branch_protection_deleted';--> statement-breakpoint
CREATE TABLE "branch_protection_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"target_branch" text NOT NULL,
	"required_approvals" integer DEFAULT 0 NOT NULL,
	"required_check_contexts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_threads_resolved" boolean DEFAULT false NOT NULL,
	"dismiss_stale_approvals" boolean DEFAULT true NOT NULL,
	"bypass_minimum_role" "branch_protection_bypass_role",
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branch_protection_rules_repository_target_branch_unique" UNIQUE("repository_id","target_branch"),
	CONSTRAINT "branch_protection_rules_target_branch_check" CHECK (length(btrim("branch_protection_rules"."target_branch")) > 0),
	CONSTRAINT "branch_protection_rules_required_approvals_check" CHECK ("branch_protection_rules"."required_approvals" >= 0),
	CONSTRAINT "branch_protection_rules_version_check" CHECK ("branch_protection_rules"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "merge_queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"state" "merge_queue_entry_state" DEFAULT 'queued' NOT NULL,
	"enqueued_by_user_id" uuid NOT NULL,
	"removed_by_user_id" uuid,
	"blocking_reasons" jsonb,
	"enqueued_base_sha" text,
	"enqueued_head_sha" text,
	"enqueued_at" timestamp DEFAULT now() NOT NULL,
	"state_changed_at" timestamp DEFAULT now() NOT NULL,
	"validating_at" timestamp,
	"merging_at" timestamp,
	"paused_at" timestamp,
	"removed_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merge_queue_entries_repository_position_unique" UNIQUE("repository_id","position"),
	CONSTRAINT "merge_queue_entries_position_check" CHECK ("merge_queue_entries"."position" > 0),
	CONSTRAINT "merge_queue_entries_terminal_state_check" CHECK ((
				("merge_queue_entries"."state"::text in ('queued', 'validating', 'merging', 'paused') and "merge_queue_entries"."removed_at" is null and "merge_queue_entries"."removed_by_user_id" is null and "merge_queue_entries"."completed_at" is null)
				or ("merge_queue_entries"."state"::text = 'removed' and "merge_queue_entries"."removed_at" is not null and "merge_queue_entries"."completed_at" is null)
				or ("merge_queue_entries"."state"::text = 'completed' and "merge_queue_entries"."completed_at" is not null and "merge_queue_entries"."removed_at" is null and "merge_queue_entries"."removed_by_user_id" is null)
			)),
	CONSTRAINT "merge_queue_entries_active_state_check" CHECK ((
				("merge_queue_entries"."state"::text <> 'validating' or "merge_queue_entries"."validating_at" is not null)
				and ("merge_queue_entries"."state"::text <> 'merging' or "merge_queue_entries"."merging_at" is not null)
				and ("merge_queue_entries"."state"::text <> 'paused' or ("merge_queue_entries"."paused_at" is not null and "merge_queue_entries"."blocking_reasons" is not null))
			))
);
--> statement-breakpoint
CREATE TABLE "repository_merge_queue_states" (
	"repository_id" uuid PRIMARY KEY NOT NULL,
	"requested_version" integer DEFAULT 0 NOT NULL,
	"completed_version" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_acquired_at" timestamp,
	"lease_expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repository_merge_queue_states_versions_check" CHECK ("repository_merge_queue_states"."requested_version" >= 0 and "repository_merge_queue_states"."completed_version" >= 0 and "repository_merge_queue_states"."completed_version" <= "repository_merge_queue_states"."requested_version"),
	CONSTRAINT "repository_merge_queue_states_lease_check" CHECK ((
				("repository_merge_queue_states"."lease_owner" is null and "repository_merge_queue_states"."lease_acquired_at" is null and "repository_merge_queue_states"."lease_expires_at" is null)
				or ("repository_merge_queue_states"."lease_owner" is not null and "repository_merge_queue_states"."lease_acquired_at" is not null and "repository_merge_queue_states"."lease_expires_at" is not null and "repository_merge_queue_states"."lease_expires_at" > "repository_merge_queue_states"."lease_acquired_at")
			))
);
--> statement-breakpoint
ALTER TABLE "pull_request_events" DROP CONSTRAINT "pull_request_events_actor_check";--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "bypass" jsonb;--> statement-breakpoint
ALTER TABLE "branch_protection_rules" ADD CONSTRAINT "branch_protection_rules_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_protection_rules" ADD CONSTRAINT "branch_protection_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_protection_rules" ADD CONSTRAINT "branch_protection_rules_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD CONSTRAINT "merge_queue_entries_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD CONSTRAINT "merge_queue_entries_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD CONSTRAINT "merge_queue_entries_enqueued_by_user_id_user_id_fk" FOREIGN KEY ("enqueued_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD CONSTRAINT "merge_queue_entries_removed_by_user_id_user_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_merge_queue_states" ADD CONSTRAINT "repository_merge_queue_states_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_protection_rules_created_by_user_id_idx" ON "branch_protection_rules" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "branch_protection_rules_updated_by_user_id_idx" ON "branch_protection_rules" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_queue_entries_active_pull_request_unique" ON "merge_queue_entries" USING btree ("pull_request_id") WHERE "merge_queue_entries"."state" in ('queued', 'validating', 'merging', 'paused');--> statement-breakpoint
CREATE INDEX "merge_queue_entries_repository_state_position_idx" ON "merge_queue_entries" USING btree ("repository_id","state","position");--> statement-breakpoint
CREATE INDEX "merge_queue_entries_pull_request_id_idx" ON "merge_queue_entries" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "merge_queue_entries_enqueued_by_user_id_idx" ON "merge_queue_entries" USING btree ("enqueued_by_user_id");--> statement-breakpoint
CREATE INDEX "merge_queue_entries_removed_by_user_id_idx" ON "merge_queue_entries" USING btree ("removed_by_user_id");--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD CONSTRAINT "pull_request_events_actor_check" CHECK ("pull_request_events"."provider"::text = 'github' or "pull_request_events"."actor_user_id" is not null or "pull_request_events"."type"::text in ('queue_paused', 'queue_removed', 'queue_resumed'));