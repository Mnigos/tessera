ALTER TYPE "public"."repository_external_source_mirror_mode" ADD VALUE 'tessera_source';--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "cutover_actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "cutover_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD COLUMN "cutover_from_mirror_mode" "repository_external_source_mirror_mode";--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_cutover_actor_user_id_user_id_fk" FOREIGN KEY ("cutover_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_external_sources" ADD CONSTRAINT "repository_external_sources_cutover_state_check" CHECK (((("mirror_mode")::text = 'tessera_source' AND "cutover_at" IS NOT NULL AND ("cutover_from_mirror_mode")::text = 'github_to_tessera') OR (("mirror_mode")::text <> 'tessera_source' AND "cutover_actor_user_id" IS NULL AND "cutover_at" IS NULL AND "cutover_from_mirror_mode" IS NULL)));
