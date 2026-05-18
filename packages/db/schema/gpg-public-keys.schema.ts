import type { GpgPublicKeyId, UserId } from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'

export interface GpgPublicKeyIdentity {
	name?: string
	email?: string
	comment?: string
	userId: string
}

export const gpgPublicKeys = pgTable(
	'gpg_public_keys',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<GpgPublicKeyId>(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		publicKey: text('public_key').notNull(),
		fingerprint: text('fingerprint').notNull(),
		keyId: text('key_id').notNull(),
		identities: jsonb('identities').$type<GpgPublicKeyIdentity[]>().notNull(),
		emails: jsonb('emails').$type<string[]>().notNull(),
		keyCreatedAt: timestamp('key_created_at').notNull(),
		keyExpiresAt: timestamp('key_expires_at'),
		isRevoked: boolean('is_revoked').default(false).notNull(),
		lastUsedAt: timestamp('last_used_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('gpg_public_keys_owner_user_id_idx').on(table.ownerUserId),
		unique('gpg_public_keys_owner_fingerprint_unique').on(
			table.ownerUserId,
			table.fingerprint
		),
	]
)

export type GpgPublicKey = typeof gpgPublicKeys.$inferSelect
export type NewGpgPublicKey = typeof gpgPublicKeys.$inferInsert

export const gpgPublicKeyRelations = relations(gpgPublicKeys, ({ one }) => ({
	ownerUser: one(user, {
		fields: [gpgPublicKeys.ownerUserId],
		references: [user.id],
	}),
}))
