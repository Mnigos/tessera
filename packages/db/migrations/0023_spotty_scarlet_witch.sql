CREATE TYPE "public"."github_sync_attempt_status" AS ENUM('running', 'succeeded', 'partial', 'retry_scheduled', 'terminal_failed', 'blocked', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."github_sync_failure_class" AS ENUM('transport', 'rate_limit', 'authentication', 'validation', 'permanent_not_found', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."github_sync_attempt_trigger" AS ENUM('webhook', 'scheduled', 'replay');--> statement-breakpoint
CREATE TABLE "github_sync_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"installation_id" uuid,
	"authority_generation" integer NOT NULL,
	"requested_sync_version" bigint NOT NULL,
	"trigger" "github_sync_attempt_trigger" NOT NULL,
	"attempt_number" integer NOT NULL,
	"job_id" text,
	"status" "github_sync_attempt_status" NOT NULL,
	"failure_class" "github_sync_failure_class",
	"failure_code" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"retry_at" timestamp,
	"replay_delivery_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_sync_attempts_operation_attempt_unique" UNIQUE("repository_id","authority_generation","requested_sync_version","attempt_number"),
	CONSTRAINT "github_sync_attempts_attempt_number_check" CHECK ("github_sync_attempts"."attempt_number" > 0),
	CONSTRAINT "github_sync_attempts_duration_check" CHECK ("github_sync_attempts"."duration_ms" is null or "github_sync_attempts"."duration_ms" >= 0),
	CONSTRAINT "github_sync_attempts_finished_check" CHECK (("github_sync_attempts"."status"::text = 'running' and "github_sync_attempts"."finished_at" is null) or ("github_sync_attempts"."status"::text <> 'running' and "github_sync_attempts"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "rate_limited_until" timestamp;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "rate_limit_remaining" integer;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "rate_limit_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "requested_sync_trigger" "github_sync_attempt_trigger" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "requested_replay_delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "github_sync_attempts" ADD CONSTRAINT "github_sync_attempts_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_sync_attempts" ADD CONSTRAINT "github_sync_attempts_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_sync_attempts" ADD CONSTRAINT "github_sync_attempts_replay_delivery_id_github_webhook_deliveries_id_fk" FOREIGN KEY ("replay_delivery_id") REFERENCES "public"."github_webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_sync_attempts_repository_started_at_idx" ON "github_sync_attempts" USING btree ("repository_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "github_sync_attempts_repository_finished_at_idx" ON "github_sync_attempts" USING btree ("repository_id","finished_at" DESC NULLS LAST) WHERE "github_sync_attempts"."finished_at" is not null;--> statement-breakpoint
CREATE INDEX "github_sync_attempts_installation_id_idx" ON "github_sync_attempts" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_sync_attempts_replay_delivery_id_idx" ON "github_sync_attempts" USING btree ("replay_delivery_id");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_pending_idx" ON "github_webhook_deliveries" USING btree ("repository_id","received_at") WHERE "github_webhook_deliveries"."status" = 'received';--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_rate_limit_remaining_check" CHECK ("github_installations"."rate_limit_remaining" is null or "github_installations"."rate_limit_remaining" >= 0);