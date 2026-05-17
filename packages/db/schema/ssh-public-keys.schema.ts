import type { SshPublicKeyId, UserId } from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'

export const sshPublicKeys = pgTable(
	'ssh_public_keys',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<SshPublicKeyId>(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		keyType: text('key_type').notNull(),
		publicKey: text('public_key').notNull(),
		fingerprintSha256: text('fingerprint_sha256').notNull(),
		comment: text('comment'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('ssh_public_keys_owner_user_id_idx').on(table.ownerUserId),
		unique('ssh_public_keys_fingerprint_unique').on(table.fingerprintSha256),
	]
)

export type SshPublicKey = typeof sshPublicKeys.$inferSelect
export type NewSshPublicKey = typeof sshPublicKeys.$inferInsert

export const sshPublicKeyRelations = relations(sshPublicKeys, ({ one }) => ({
	ownerUser: one(user, {
		fields: [sshPublicKeys.ownerUserId],
		references: [user.id],
	}),
}))
