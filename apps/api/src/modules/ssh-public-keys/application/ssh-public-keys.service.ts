import { Injectable } from '@nestjs/common'
import type { CreateSshPublicKeyInput, SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { toSshPublicKeyOutput } from '../domain/ssh-public-key'
import {
	DuplicateSshPublicKeyError,
	SshPublicKeyAuthenticationError,
	SshPublicKeyNotFoundError,
} from '../domain/ssh-public-key.errors'
import { normalizeSshPublicKey } from '../domain/ssh-public-key.helpers'
import { SshPublicKeysRepository } from '../infrastructure/ssh-public-keys.repository'

const SSH_PUBLIC_KEY_UNIQUE_CONSTRAINTS = new Set([
	'ssh_public_keys_fingerprint_unique',
])

@Injectable()
export class SshPublicKeysService {
	constructor(
		private readonly sshPublicKeysRepository: SshPublicKeysRepository
	) {}

	async create(
		userId: UserId,
		{ publicKey, title }: CreateSshPublicKeyInput
	): Promise<SshPublicKey> {
		const normalizedKey = normalizeSshPublicKey(publicKey)

		try {
			const sshPublicKey = await this.sshPublicKeysRepository.create({
				userId,
				title,
				...normalizedKey,
			})

			return toSshPublicKeyOutput(sshPublicKey)
		} catch (error) {
			if (isUniqueViolation(error, SSH_PUBLIC_KEY_UNIQUE_CONSTRAINTS))
				throw new DuplicateSshPublicKeyError({
					userId,
					fingerprintSha256: normalizedKey.fingerprintSha256,
				})

			throw error
		}
	}

	async list(userId: UserId): Promise<SshPublicKey[]> {
		const sshPublicKeys = await this.sshPublicKeysRepository.list({ userId })

		return sshPublicKeys.map(toSshPublicKeyOutput)
	}

	async findOwnerByFingerprint(fingerprintSha256: string): Promise<UserId> {
		const sshPublicKey = await this.sshPublicKeysRepository.findByFingerprint({
			fingerprintSha256,
		})

		if (!sshPublicKey)
			throw new SshPublicKeyAuthenticationError({ fingerprintSha256 })

		return sshPublicKey.ownerUserId
	}

	async revoke(userId: UserId, sshPublicKeyId: SshPublicKeyId): Promise<void> {
		await this.delete(userId, sshPublicKeyId)
	}

	async delete(userId: UserId, sshPublicKeyId: SshPublicKeyId): Promise<void> {
		const deletedId = await this.sshPublicKeysRepository.delete({
			userId,
			sshPublicKeyId,
		})

		if (!deletedId)
			throw new SshPublicKeyNotFoundError({ userId, sshPublicKeyId })
	}
}
