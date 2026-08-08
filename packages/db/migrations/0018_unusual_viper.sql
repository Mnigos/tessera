CREATE TYPE "public"."github_webhook_target_resource_kind" AS ENUM('pull_request', 'issue_comment', 'review_comment', 'review', 'review_thread');--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_resource_kind" "github_webhook_target_resource_kind";--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_resource_node_id" text;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_resource_numeric_id" bigint;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_team_node_id" text;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD COLUMN "target_team_slug" text;