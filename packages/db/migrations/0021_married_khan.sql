ALTER TYPE "public"."repository_event_type" ADD VALUE 'check_status_credential_created';--> statement-breakpoint
ALTER TYPE "public"."repository_event_type" ADD VALUE 'check_status_credential_revoked';--> statement-breakpoint
CREATE TABLE "check_status_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"api_key_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "check_status_credentials_api_key_id_unique" UNIQUE("api_key_id")
);
--> statement-breakpoint
CREATE TABLE "check_status_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "check_status_providers_repository_key_unique" UNIQUE("repository_id","key"),
	CONSTRAINT "check_status_providers_key_check" CHECK (length(btrim("check_status_providers"."key")) > 0),
	CONSTRAINT "check_status_providers_display_name_check" CHECK (length(btrim("check_status_providers"."display_name")) > 0)
);
--> statement-breakpoint
DROP INDEX "checks_status_stream_unique";--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "check_status_credentials" ADD CONSTRAINT "check_status_credentials_provider_id_check_status_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."check_status_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_status_credentials" ADD CONSTRAINT "check_status_credentials_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_status_credentials" ADD CONSTRAINT "check_status_credentials_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_status_providers" ADD CONSTRAINT "check_status_providers_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_status_providers" ADD CONSTRAINT "check_status_providers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_status_credentials_provider_idx" ON "check_status_credentials" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "check_status_credentials_created_by_user_id_idx" ON "check_status_credentials" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "check_status_providers_created_by_user_id_idx" ON "check_status_providers" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_credential_id_check_status_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."check_status_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_provider_id_check_status_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."check_status_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_observations_credential_idx" ON "check_observations" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_provider_status_stream_unique" ON "checks" USING btree ("repository_id","sha","context","provider_id") WHERE "checks"."kind" = 'status' and "checks"."provider_id" is not null;--> statement-breakpoint
CREATE INDEX "checks_provider_idx" ON "checks" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_status_stream_unique" ON "checks" USING btree ("repository_id","sha","context") WHERE "checks"."kind" = 'status' and "checks"."provider_id" is null;