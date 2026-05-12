ALTER TABLE "repositories" DROP CONSTRAINT "repositories_owner_user_name_unique";--> statement-breakpoint
ALTER TABLE "repositories" DROP CONSTRAINT "repositories_owner_organization_name_unique";--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "slug" text;--> statement-breakpoint
WITH normalized_repositories AS (
	SELECT
		"id",
		coalesce(
			nullif(
				trim(both '-' from left(
					trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
					51
				)),
				''
			),
			'repository'
		) AS "base_slug",
		left(replace("id"::text, '-', ''), 12) AS "id_suffix"
	FROM "repositories"
)
UPDATE "repositories"
SET "slug" = normalized_repositories."base_slug" || '-' || normalized_repositories."id_suffix"
FROM normalized_repositories
WHERE "repositories"."id" = normalized_repositories."id";--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_owner_user_slug_unique" UNIQUE("owner_user_id","slug");--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_owner_organization_slug_unique" UNIQUE("owner_organization_id","slug");--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_exactly_one_owner_check" CHECK (((case when "owner_user_id" is not null then 1 else 0 end) + (case when "owner_organization_id" is not null then 1 else 0 end)) = 1);
