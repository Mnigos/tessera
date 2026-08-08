ALTER TABLE "pull_request_reviews" DROP CONSTRAINT "pull_request_reviews_state_check";--> statement-breakpoint
DROP INDEX "github_pull_request_mappings_conversation_synced_at_idx";--> statement-breakpoint
CREATE INDEX "github_pull_request_mappings_conversation_synced_at_idx" ON "github_pull_request_mappings" USING btree ("repository_id","conversation_synced_at" NULLS FIRST,"external_number");--> statement-breakpoint
ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_state_check" CHECK ((
				("pull_request_reviews"."state"::text = 'pending' and "pull_request_reviews"."outcome" is null and "pull_request_reviews"."submitted_at" is null and "pull_request_reviews"."dismissed_at" is null and "pull_request_reviews"."dismissed_by_user_id" is null)
				or ("pull_request_reviews"."state"::text = 'submitted' and "pull_request_reviews"."outcome" is not null and "pull_request_reviews"."submitted_at" is not null and "pull_request_reviews"."dismissed_at" is null and "pull_request_reviews"."dismissed_by_user_id" is null)
				or ("pull_request_reviews"."state"::text = 'dismissed' and "pull_request_reviews"."submitted_at" is not null and "pull_request_reviews"."dismissed_at" is not null and ("pull_request_reviews"."provider"::text = 'github' or ("pull_request_reviews"."outcome" is not null and "pull_request_reviews"."dismissed_by_user_id" is not null)))
			));