ALTER TABLE "pull_requests" ADD COLUMN "last_activity_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing rows have never had activity recorded onto them, so the column is
-- seeded from the best evidence already on hand: the row's own last write, or
-- its newest event when the timeline reaches further than that write does.
UPDATE pull_requests
SET last_activity_at = GREATEST(
  updated_at,
  COALESCE(
    (SELECT MAX(e.created_at) FROM pull_request_events e WHERE e.pull_request_id = pull_requests.id),
    updated_at
  )
);--> statement-breakpoint
CREATE INDEX "pull_requests_repository_created_at_number_idx" ON "pull_requests" USING btree ("repository_id","created_at","number");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_updated_at_number_idx" ON "pull_requests" USING btree ("repository_id","updated_at","number");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_last_activity_at_number_idx" ON "pull_requests" USING btree ("repository_id","last_activity_at","number");
