import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, type GpgPublicKey, gpgPublicKeys } from '@repo/db'
import type { GpgPublicKeyId, UserId } from '@repo/domain'
import type { NormalizedGpgPublicKey } from '../domain/gpg-public-key.helpers'

interface UserParams {
	userId: UserId
}

interface CreateParams extends UserParams, NormalizedGpgPublicKey {
	title: string
}

interface KeyParams extends UserParams {
	gpgPublicKeyId: GpgPublicKeyId
}

@Injectable()
export class GpgPublicKeysRepository {
	constructor(private readonly db: Database) {}

	async create({
		emails,
		fingerprint,
		identities,
		isRevoked,
		keyCreatedAt,
		keyExpiresAt,
		keyId,
		publicKey,
		title,
		userId,
	}: CreateParams): Promise<GpgPublicKey> {
		const [gpgPublicKey] = await this.db
			.insert(gpgPublicKeys)
			.values({
				ownerUserId: userId,
				title,
				publicKey,
				fingerprint,
				keyId,
				identities,
				emails,
				keyCreatedAt,
				keyExpiresAt,
				isRevoked,
			})
			.returning({
				id: gpgPublicKeys.id,
				ownerUserId: gpgPublicKeys.ownerUserId,
				title: gpgPublicKeys.title,
				publicKey: gpgPublicKeys.publicKey,
				fingerprint: gpgPublicKeys.fingerprint,
				keyId: gpgPublicKeys.keyId,
				identities: gpgPublicKeys.identities,
				emails: gpgPublicKeys.emails,
				keyCreatedAt: gpgPublicKeys.keyCreatedAt,
				keyExpiresAt: gpgPublicKeys.keyExpiresAt,
				isRevoked: gpgPublicKeys.isRevoked,
				lastUsedAt: gpgPublicKeys.lastUsedAt,
				createdAt: gpgPublicKeys.createdAt,
				updatedAt: gpgPublicKeys.updatedAt,
			})

		if (!gpgPublicKey) throw new Error('GPG public key insert returned no rows')

		return gpgPublicKey
	}

	async list({ userId }: UserParams) {
		return await this.db.query.gpgPublicKeys.findMany({
			where: eq(gpgPublicKeys.ownerUserId, userId),
			orderBy: [asc(gpgPublicKeys.createdAt)],
		})
	}

	async delete({
		gpgPublicKeyId,
		userId,
	}: KeyParams): Promise<GpgPublicKeyId | undefined> {
		const [deleted] = await this.db
			.delete(gpgPublicKeys)
			.where(
				and(
					eq(gpgPublicKeys.id, gpgPublicKeyId),
					eq(gpgPublicKeys.ownerUserId, userId)
				)
			)
			.returning({ id: gpgPublicKeys.id })

		return deleted?.id
	}
}
