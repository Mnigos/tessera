ALTER TABLE "repository_external_sources" ADD COLUMN "next_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "repository_external_sources"
SET "next_sync_at" = greatest(
	coalesce("last_sync_succeeded_at", 'epoch'::timestamp),
	coalesce("last_sync_failed_at", 'epoch'::timestamp),
	coalesce("updated_at", 'epoch'::timestamp),
	coalesce("created_at", 'epoch'::timestamp)
) + interval '15 minutes'
WHERE "provider" = 'github'
	AND "mirror_mode" = 'github_to_tessera'
	AND "next_sync_at" is null;--> statement-breakpoint
CREATE INDEX "repository_external_sources_due_sync_idx" ON "repository_external_sources" USING btree ("next_sync_at") WHERE "repository_external_sources"."provider" = 'github' and "repository_external_sources"."mirror_mode" = 'github_to_tessera' and "repository_external_sources"."next_sync_at" is not null;
