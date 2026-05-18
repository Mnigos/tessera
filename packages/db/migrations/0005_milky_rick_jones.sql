CREATE TABLE "gpg_public_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"key_id" text NOT NULL,
	"identities" jsonb NOT NULL,
	"emails" jsonb NOT NULL,
	"key_created_at" timestamp NOT NULL,
	"key_expires_at" timestamp,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gpg_public_keys_owner_fingerprint_unique" UNIQUE("owner_user_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "gpg_public_keys" ADD CONSTRAINT "gpg_public_keys_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gpg_public_keys_owner_user_id_idx" ON "gpg_public_keys" USING btree ("owner_user_id");
