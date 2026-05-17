import { Injectable } from '@nestjs/common'
import type { CreateSshPublicKeyInput, SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { toSshPublicKeyOutput } from '../domain/ssh-public-key'
import {
	DuplicateSshPublicKeyError,
	SshPublicKeyNotFoundError,
} from '../domain/ssh-public-key.errors'
import { normalizeSshPublicKey } from '../domain/ssh-public-key.helpers'
import { SshPublicKeysRepository } from '../infrastructure/ssh-public-keys.repository'

const SSH_PUBLIC_KEY_UNIQUE_CONSTRAINTS = new Set([
	'ssh_public_keys_owner_fingerprint_unique',
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

			if (!sshPublicKey)
				throw new SshPublicKeyNotFoundError({
					userId,
					fingerprintSha256: normalizedKey.fingerprintSha256,
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

	async revoke(userId: UserId, sshPublicKeyId: SshPublicKeyId): Promise<void> {
		await this.delete(userId, sshPublicKeyId)
	}

	async delete(userId: UserId, sshPublicKeyId: SshPublicKeyId): Promise<void> {
		const sshPublicKey = await this.sshPublicKeysRepository.findOwned({
			userId,
			sshPublicKeyId,
		})

		if (!sshPublicKey)
			throw new SshPublicKeyNotFoundError({ userId, sshPublicKeyId })

		await this.sshPublicKeysRepository.delete({ userId, sshPublicKeyId })
	}
}
