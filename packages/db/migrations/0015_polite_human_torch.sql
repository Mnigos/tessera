CREATE TYPE "public"."pull_request_comment_state" AS ENUM('published', 'pending');--> statement-breakpoint
CREATE TYPE "public"."pull_request_thread_kind" AS ENUM('top_level', 'inline');--> statement-breakpoint
CREATE TYPE "public"."pull_request_thread_side" AS ENUM('left', 'right');--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'commented';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'thread_resolved';--> statement-breakpoint
ALTER TYPE "public"."pull_request_event_type" ADD VALUE 'thread_unresolved';--> statement-breakpoint
CREATE TABLE "pull_request_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"state" "pull_request_comment_state" DEFAULT 'published' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	CONSTRAINT "pull_request_comments_body_check" CHECK (length(btrim("pull_request_comments"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pull_request_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"kind" "pull_request_thread_kind" NOT NULL,
	"path" text,
	"side" "pull_request_thread_side",
	"line" integer,
	"anchor_sha" text,
	"base_sha" text,
	"head_sha" text,
	"line_excerpt" text,
	"resolved_at" timestamp,
	"resolved_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_threads_anchor_check" CHECK ((
				("pull_request_threads"."kind"::text = 'top_level' and "pull_request_threads"."path" is null and "pull_request_threads"."side" is null and "pull_request_threads"."line" is null and "pull_request_threads"."anchor_sha" is null and "pull_request_threads"."base_sha" is null and "pull_request_threads"."head_sha" is null and "pull_request_threads"."line_excerpt" is null)
				or ("pull_request_threads"."kind"::text = 'inline' and "pull_request_threads"."path" is not null and "pull_request_threads"."side" is not null and "pull_request_threads"."line" is not null and "pull_request_threads"."line" > 0 and "pull_request_threads"."anchor_sha" is not null and "pull_request_threads"."base_sha" is not null and "pull_request_threads"."head_sha" is not null and "pull_request_threads"."line_excerpt" is not null)
			)),
	CONSTRAINT "pull_request_threads_resolution_check" CHECK (("pull_request_threads"."resolved_at" is null) = ("pull_request_threads"."resolved_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "pull_request_events" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD CONSTRAINT "pull_request_comments_thread_id_pull_request_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."pull_request_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_comments" ADD CONSTRAINT "pull_request_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD CONSTRAINT "pull_request_threads_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_threads" ADD CONSTRAINT "pull_request_threads_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_comments_thread_created_at_idx" ON "pull_request_comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_request_threads_pull_request_created_at_idx" ON "pull_request_threads" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_request_threads_pull_request_path_idx" ON "pull_request_threads" USING btree ("pull_request_id","path");