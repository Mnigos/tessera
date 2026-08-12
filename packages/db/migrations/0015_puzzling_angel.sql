ALTER TABLE "repository_external_sources" ADD COLUMN "installation_account_node_id" text;--> statement-breakpoint
-- Backfill the installation account identity for sources that are already bound
-- to an installation, so authentic future webhooks are scoped to that account
-- and existing bindings are not rejected as cross-account.
UPDATE "repository_external_sources" AS "s"
SET "installation_account_node_id" = "i"."account_node_id"
FROM "github_installations" AS "i"
WHERE "s"."installation_id" = "i"."id"
	AND "s"."installation_account_node_id" IS NULL;--> statement-breakpoint
-- Deterministically resolve any pre-existing ambiguous active bindings (more
-- than one github_to_tessera source with an installation for the same provider
-- repository). Keep a single winner ordered by a live installation, then the
-- earliest creation, then id; quarantine the rest by detaching the
-- installation, reverting to an imported (non-syncing) mirror mode, blocking
-- sync, and bumping the authority generation so no in-flight lease can act.
WITH "ranked" AS (
	SELECT
		"s"."id" AS "id",
		row_number() OVER (
			PARTITION BY "s"."provider", "s"."external_repository_id"
			ORDER BY
				("i"."id" IS NOT NULL AND "i"."deleted_at" IS NULL AND "i"."suspended_at" IS NULL) DESC,
				"s"."created_at" ASC,
				"s"."id" ASC
		) AS "rn"
	FROM "repository_external_sources" AS "s"
	LEFT JOIN "github_installations" AS "i" ON "i"."id" = "s"."installation_id"
	WHERE "s"."mirror_mode" = 'github_to_tessera'
		AND "s"."installation_id" IS NOT NULL
)
UPDATE "repository_external_sources" AS "s"
SET
	"installation_id" = NULL,
	"mirror_mode" = 'imported',
	"sync_status" = 'blocked',
	"sync_failure_code" = 'ambiguous_provider_binding',
	"sync_failure_reason" = 'Multiple Tessera repositories mapped to the same GitHub repository; this mirror was quarantined for manual review.',
	"next_sync_at" = NULL,
	"authority_generation" = "s"."authority_generation" + 1,
	"sync_lease_owner" = NULL,
	"sync_lease_acquired_at" = NULL,
	"sync_lease_expires_at" = NULL
FROM "ranked"
WHERE "ranked"."id" = "s"."id"
	AND "ranked"."rn" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_external_sources_active_github_binding_unique" ON "repository_external_sources" USING btree ("provider","external_repository_id") WHERE "repository_external_sources"."mirror_mode" = 'github_to_tessera' and "repository_external_sources"."installation_id" is not null;--> statement-breakpoint
CREATE INDEX "repository_external_sources_installation_account_node_id_idx" ON "repository_external_sources" USING btree ("installation_account_node_id");
