CREATE TABLE "ssh_public_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"key_type" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_public_keys_owner_fingerprint_unique" UNIQUE("owner_user_id","fingerprint_sha256")
);
--> statement-breakpoint
ALTER TABLE "ssh_public_keys" ADD CONSTRAINT "ssh_public_keys_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssh_public_keys_owner_user_id_idx" ON "ssh_public_keys" USING btree ("owner_user_id");