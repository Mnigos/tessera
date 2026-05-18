import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, type SshPublicKey, sshPublicKeys } from '@repo/db'
import type { SshPublicKeyId, UserId } from '@repo/domain'

interface UserParams {
	userId: UserId
}

interface CreateParams extends UserParams {
	title: string
	keyType: string
	publicKey: string
	fingerprint: string
	comment: string | undefined
}

interface KeyParams extends UserParams {
	sshPublicKeyId: SshPublicKeyId
}

interface FingerprintParams {
	fingerprint: string
}

@Injectable()
export class SshPublicKeysRepository {
	constructor(private readonly db: Database) {}

	async create({
		comment,
		fingerprint,
		keyType,
		publicKey,
		title,
		userId,
	}: CreateParams): Promise<SshPublicKey> {
		const [sshPublicKey] = await this.db
			.insert(sshPublicKeys)
			.values({
				ownerUserId: userId,
				title,
				keyType,
				publicKey,
				fingerprint,
				comment,
			})
			.returning({
				id: sshPublicKeys.id,
				ownerUserId: sshPublicKeys.ownerUserId,
				title: sshPublicKeys.title,
				keyType: sshPublicKeys.keyType,
				publicKey: sshPublicKeys.publicKey,
				fingerprint: sshPublicKeys.fingerprint,
				comment: sshPublicKeys.comment,
				lastUsedAt: sshPublicKeys.lastUsedAt,
				createdAt: sshPublicKeys.createdAt,
				updatedAt: sshPublicKeys.updatedAt,
			})

		if (!sshPublicKey) throw new Error('SSH public key insert returned no rows')

		return sshPublicKey
	}

	async list({ userId }: UserParams) {
		return await this.db.query.sshPublicKeys.findMany({
			where: eq(sshPublicKeys.ownerUserId, userId),
			orderBy: [asc(sshPublicKeys.createdAt)],
		})
	}

	async findByFingerprint({
		fingerprint,
	}: FingerprintParams): Promise<SshPublicKey | undefined> {
		return await this.db.query.sshPublicKeys.findFirst({
			where: eq(sshPublicKeys.fingerprint, fingerprint),
		})
	}

	async recordUsageByFingerprint({
		fingerprint,
	}: FingerprintParams): Promise<void> {
		await this.db
			.update(sshPublicKeys)
			.set({ lastUsedAt: new Date() })
			.where(eq(sshPublicKeys.fingerprint, fingerprint))
	}

	async delete({
		sshPublicKeyId,
		userId,
	}: KeyParams): Promise<SshPublicKeyId | undefined> {
		const [deleted] = await this.db
			.delete(sshPublicKeys)
			.where(
				and(
					eq(sshPublicKeys.id, sshPublicKeyId),
					eq(sshPublicKeys.ownerUserId, userId)
				)
			)
			.returning({ id: sshPublicKeys.id })

		return deleted?.id
	}
}
