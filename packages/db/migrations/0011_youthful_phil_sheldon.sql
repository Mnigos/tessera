CREATE TYPE "public"."pull_request_event_type" AS ENUM('opened', 'edited', 'closed', 'reopened', 'merged');--> statement-breakpoint
CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TABLE "pull_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"type" "pull_request_event_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"author_user_id" uuid NOT NULL,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"opening_base_sha" text NOT NULL,
	"opening_head_sha" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"state" "pull_request_state" DEFAULT 'open' NOT NULL,
	"merge_commit_sha" text,
	"merge_actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"merged_at" timestamp,
	CONSTRAINT "pull_requests_repository_number_unique" UNIQUE("repository_id","number"),
	CONSTRAINT "pull_requests_number_check" CHECK ("pull_requests"."number" > 0),
	CONSTRAINT "pull_requests_distinct_branches_check" CHECK ("pull_requests"."source_branch" <> "pull_requests"."target_branch"),
	CONSTRAINT "pull_requests_lifecycle_state_check" CHECK ((
				("pull_requests"."state"::text = 'open' and "pull_requests"."closed_at" is null and "pull_requests"."merged_at" is null and "pull_requests"."merge_commit_sha" is null and "pull_requests"."merge_actor_user_id" is null)
				or ("pull_requests"."state"::text = 'closed' and "pull_requests"."closed_at" is not null and "pull_requests"."merged_at" is null and "pull_requests"."merge_commit_sha" is null and "pull_requests"."merge_actor_user_id" is null)
				or ("pull_requests"."state"::text = 'merged' and "pull_requests"."closed_at" is not null and "pull_requests"."merged_at" is not null and "pull_requests"."merge_commit_sha" is not null and "pull_requests"."merge_actor_user_id" is not null)
			))
);
--> statement-breakpoint
CREATE TABLE "repository_pull_request_counters" (
	"repository_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "repository_pull_request_counters_next_number_check" CHECK ("repository_pull_request_counters"."next_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD CONSTRAINT "pull_request_events_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD CONSTRAINT "pull_request_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_merge_actor_user_id_user_id_fk" FOREIGN KEY ("merge_actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_pull_request_counters" ADD CONSTRAINT "repository_pull_request_counters_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_events_pull_request_created_at_idx" ON "pull_request_events" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_request_events_actor_user_id_idx" ON "pull_request_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_open_branch_pair_unique" ON "pull_requests" USING btree ("repository_id","source_branch","target_branch") WHERE "pull_requests"."state" = 'open';--> statement-breakpoint
CREATE INDEX "pull_requests_repository_state_number_idx" ON "pull_requests" USING btree ("repository_id","state","number");--> statement-breakpoint
CREATE INDEX "pull_requests_author_user_id_idx" ON "pull_requests" USING btree ("author_user_id");
