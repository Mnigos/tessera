CREATE TABLE "pull_request_merge_intents" (
	"pull_request_id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"started_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD CONSTRAINT "pull_request_merge_intents_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_merge_intents" ADD CONSTRAINT "pull_request_merge_intents_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_merge_intents_actor_user_id_idx" ON "pull_request_merge_intents" USING btree ("actor_user_id");