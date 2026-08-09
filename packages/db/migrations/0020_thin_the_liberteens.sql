ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'head_updated';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'force_pushed';--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_events_idempotency_key_unique" ON "pull_request_events" USING btree ("pull_request_id","idempotency_key") WHERE "pull_request_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "pull_requests_open_source_branch_idx" ON "pull_requests" USING btree ("repository_id","source_branch") WHERE "pull_requests"."state" = 'open' and "pull_requests"."provider" = 'tessera';