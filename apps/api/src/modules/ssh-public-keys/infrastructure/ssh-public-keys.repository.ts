import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, sshPublicKeys } from '@repo/db'
import type { SshPublicKeyId, UserId } from '@repo/domain'

interface UserParams {
	userId: UserId
}

interface CreateParams extends UserParams {
	title: string
	keyType: string
	publicKey: string
	fingerprintSha256: string
	comment: string | undefined
}

interface KeyParams extends UserParams {
	sshPublicKeyId: SshPublicKeyId
}

@Injectable()
export class SshPublicKeysRepository {
	constructor(private readonly db: Database) {}

	async create({
		comment,
		fingerprintSha256,
		keyType,
		publicKey,
		title,
		userId,
	}: CreateParams) {
		const [sshPublicKey] = await this.db
			.insert(sshPublicKeys)
			.values({
				ownerUserId: userId,
				title,
				keyType,
				publicKey,
				fingerprintSha256,
				comment,
			})
			.returning({
				id: sshPublicKeys.id,
				ownerUserId: sshPublicKeys.ownerUserId,
				title: sshPublicKeys.title,
				keyType: sshPublicKeys.keyType,
				publicKey: sshPublicKeys.publicKey,
				fingerprintSha256: sshPublicKeys.fingerprintSha256,
				comment: sshPublicKeys.comment,
				createdAt: sshPublicKeys.createdAt,
				updatedAt: sshPublicKeys.updatedAt,
			})

		return sshPublicKey
	}

	async list({ userId }: UserParams) {
		return await this.db.query.sshPublicKeys.findMany({
			where: eq(sshPublicKeys.ownerUserId, userId),
			orderBy: [asc(sshPublicKeys.createdAt)],
		})
	}

	async findOwned({ sshPublicKeyId, userId }: KeyParams) {
		return await this.db.query.sshPublicKeys.findFirst({
			where: and(
				eq(sshPublicKeys.id, sshPublicKeyId),
				eq(sshPublicKeys.ownerUserId, userId)
			),
		})
	}

	async delete({ sshPublicKeyId, userId }: KeyParams): Promise<void> {
		await this.db
			.delete(sshPublicKeys)
			.where(
				and(
					eq(sshPublicKeys.id, sshPublicKeyId),
					eq(sshPublicKeys.ownerUserId, userId)
				)
			)
	}
}
