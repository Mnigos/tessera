CREATE TYPE "public"."repository_collaborator_role" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."repository_event_type" AS ENUM('collaborator_added', 'collaborator_role_changed', 'collaborator_removed');--> statement-breakpoint
CREATE TABLE "repository_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "repository_collaborator_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repository_collaborators_repository_user_unique" UNIQUE("repository_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "repository_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"type" "repository_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_collaborators" ADD CONSTRAINT "repository_collaborators_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborators" ADD CONSTRAINT "repository_collaborators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_events" ADD CONSTRAINT "repository_events_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_events" ADD CONSTRAINT "repository_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_collaborators_user_id_idx" ON "repository_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repository_events_repository_created_at_idx" ON "repository_events" USING btree ("repository_id","created_at");