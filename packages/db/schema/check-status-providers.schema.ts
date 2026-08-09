import type {
	ApiKeyId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	check,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { apikey, user } from './auth.schema'
import { repositories } from './repositories.schema'

/**
 * An external system that publishes commit statuses to one repository.
 *
 * The provider is the stream identity, not the secret: rotating a credential
 * issues a new key against the same provider, so a context that provider has
 * been reporting on keeps its history instead of forking into a second stream.
 * The key is the stable slug callers and required-context selectors would name;
 * the display name is what a reader sees and may change freely.
 */
export const checkStatusProviders = pgTable(
	'check_status_providers',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<CheckStatusProviderId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		displayName: text('display_name').notNull(),
		// restrict is deliberate: a provider names who admitted it into the
		// repository, so account deletion has to handle these rows explicitly
		// (mirrors branch_protection_rules).
		createdByUserId: uuid('created_by_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('check_status_providers_repository_key_unique').on(
			table.repositoryId,
			table.key
		),
		index('check_status_providers_created_by_user_id_idx').on(
			table.createdByUserId
		),
		check(
			'check_status_providers_key_check',
			sql`length(btrim(${table.key})) > 0`
		),
		check(
			'check_status_providers_display_name_check',
			sql`length(btrim(${table.displayName})) > 0`
		),
	]
)

/**
 * One secret a provider publishes with. The secret itself never lands here —
 * Better Auth holds the hash, the expiry and the enablement flag under its own
 * API-key configuration, and this row is the repository-confined identity that
 * key stands for.
 *
 * Revocation is recorded here as well as on the key so a published observation
 * can still name the exact credential that wrote it after the key is gone.
 */
export const checkStatusCredentials = pgTable(
	'check_status_credentials',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<CheckStatusCredentialId>(),
		providerId: uuid('provider_id')
			.notNull()
			.$type<CheckStatusProviderId>()
			.references(() => checkStatusProviders.id, { onDelete: 'cascade' }),
		/**
		 * The secret half, which outlives nothing. Better Auth deletes an expired
		 * key on the next attempt to use it, and cascading that into this row would
		 * try to erase a credential the observation ledger still names. The key
		 * goes, the attribution stays, and a credential with no key authenticates
		 * nothing because the guard resolves it by key.
		 */
		apiKeyId: uuid('api_key_id')
			.unique()
			.$type<ApiKeyId>()
			.references(() => apikey.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		/** Absent is a live credential; a date is one that may no longer publish. */
		revokedAt: timestamp('revoked_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('check_status_credentials_provider_idx').on(table.providerId),
		index('check_status_credentials_created_by_user_id_idx').on(
			table.createdByUserId
		),
	]
)

export type CheckStatusProvider = typeof checkStatusProviders.$inferSelect
export type NewCheckStatusProvider = typeof checkStatusProviders.$inferInsert
export type CheckStatusCredential = typeof checkStatusCredentials.$inferSelect
export type NewCheckStatusCredential =
	typeof checkStatusCredentials.$inferInsert

export const checkStatusProviderRelations = relations(
	checkStatusProviders,
	({ many, one }) => ({
		repository: one(repositories, {
			fields: [checkStatusProviders.repositoryId],
			references: [repositories.id],
		}),
		createdByUser: one(user, {
			fields: [checkStatusProviders.createdByUserId],
			references: [user.id],
			relationName: 'check_status_provider_creator',
		}),
		credentials: many(checkStatusCredentials),
	})
)

export const checkStatusCredentialRelations = relations(
	checkStatusCredentials,
	({ one }) => ({
		provider: one(checkStatusProviders, {
			fields: [checkStatusCredentials.providerId],
			references: [checkStatusProviders.id],
		}),
		apiKey: one(apikey, {
			fields: [checkStatusCredentials.apiKeyId],
			references: [apikey.id],
		}),
		createdByUser: one(user, {
			fields: [checkStatusCredentials.createdByUserId],
			references: [user.id],
			relationName: 'check_status_credential_creator',
		}),
	})
)
