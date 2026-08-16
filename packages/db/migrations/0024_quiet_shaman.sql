ALTER TABLE "repositories" DROP CONSTRAINT "repositories_owner_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_owner_organization_id_organization_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;