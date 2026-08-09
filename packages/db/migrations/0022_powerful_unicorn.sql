CREATE TYPE "public"."pull_request_merge_strategy" AS ENUM('merge_commit', 'squash', 'rebase', 'fast_forward');--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD COLUMN "strategy" "pull_request_merge_strategy" DEFAULT 'merge_commit' NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD COLUMN "squash_title" text;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD COLUMN "squash_body" text;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "strategy" "pull_request_merge_strategy" DEFAULT 'merge_commit' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "expected_base_sha" text;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "expected_head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "squash_title" text;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD COLUMN "squash_body" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merge_strategy" "pull_request_merge_strategy";--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merged_base_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merged_head_sha" text;--> statement-breakpoint
ALTER TABLE "merge_queue_entries" ADD CONSTRAINT "merge_queue_entries_squash_options_check" CHECK ("merge_queue_entries"."strategy"::text = 'squash' or ("merge_queue_entries"."squash_title" is null and "merge_queue_entries"."squash_body" is null));--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD CONSTRAINT "pull_request_merge_intents_request_check" CHECK ((
				(
					"pull_request_merge_intents"."expected_base_sha" is null and "pull_request_merge_intents"."expected_head_sha" is null
					and "pull_request_merge_intents"."commit_message" is null and "pull_request_merge_intents"."squash_title" is null and "pull_request_merge_intents"."squash_body" is null
				)
				or (
					"pull_request_merge_intents"."expected_base_sha" is not null and "pull_request_merge_intents"."expected_head_sha" is not null
					and case "pull_request_merge_intents"."strategy"::text
						when 'merge_commit' then "pull_request_merge_intents"."commit_message" is not null and "pull_request_merge_intents"."squash_title" is null and "pull_request_merge_intents"."squash_body" is null
						when 'squash' then "pull_request_merge_intents"."commit_message" is null and "pull_request_merge_intents"."squash_title" is not null and "pull_request_merge_intents"."squash_body" is not null
						else "pull_request_merge_intents"."commit_message" is null and "pull_request_merge_intents"."squash_title" is null and "pull_request_merge_intents"."squash_body" is null
					end
				)
			));--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_merged_comparison_check" CHECK ((
				("pull_requests"."merged_base_sha" is null) = ("pull_requests"."merged_head_sha" is null)
				and ("pull_requests"."state"::text = 'merged' or ("pull_requests"."merged_base_sha" is null and "pull_requests"."merge_strategy" is null))
			));--> statement-breakpoint
-- Every native merge Tessera has ever made was a two-parent merge commit, which
-- is the only strategy that existed. Synchronized pull requests are left alone:
-- GitHub merged them and did not say how.
--
-- The merge-time tips are deliberately not backfilled. They cannot be recovered
-- for a fast-forward or a squash that never happened, and for these rows the
-- merge commit's own parents are exactly the pair that was merged — which is
-- what the comparison helper still falls back to when these columns are null.
UPDATE "pull_requests"
SET "merge_strategy" = 'merge_commit'
WHERE "state" = 'merged'
	AND "provider" = 'tessera'
	AND "merge_strategy" IS NULL;
