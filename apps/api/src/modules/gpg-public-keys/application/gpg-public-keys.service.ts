import { Injectable } from '@nestjs/common'
import type { CreateGpgPublicKeyInput, GpgPublicKey } from '@repo/contracts'
import type { GpgPublicKeyId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { toGpgPublicKeyOutput } from '../domain/gpg-public-key'
import {
	DuplicateGpgPublicKeyError,
	GpgPublicKeyNotFoundError,
} from '../domain/gpg-public-key.errors'
import { normalizeGpgPublicKey } from '../domain/gpg-public-key.helpers'
import { GpgPublicKeysRepository } from '../infrastructure/gpg-public-keys.repository'

const GPG_PUBLIC_KEY_UNIQUE_CONSTRAINTS = new Set([
	'gpg_public_keys_fingerprint_unique',
	'gpg_public_keys_owner_fingerprint_unique',
])

@Injectable()
export class GpgPublicKeysService {
	constructor(
		private readonly gpgPublicKeysRepository: GpgPublicKeysRepository
	) {}

	async create(
		userId: UserId,
		{ publicKey, title }: CreateGpgPublicKeyInput
	): Promise<GpgPublicKey> {
		const normalizedKey = await normalizeGpgPublicKey(publicKey)

		try {
			const gpgPublicKey = await this.gpgPublicKeysRepository.create({
				userId,
				title,
				...normalizedKey,
			})

			return toGpgPublicKeyOutput(gpgPublicKey)
		} catch (error) {
			if (isUniqueViolation(error, GPG_PUBLIC_KEY_UNIQUE_CONSTRAINTS))
				throw new DuplicateGpgPublicKeyError({
					userId,
					fingerprint: normalizedKey.fingerprint,
				})

			throw error
		}
	}

	async list(userId: UserId): Promise<GpgPublicKey[]> {
		const gpgPublicKeys = await this.gpgPublicKeysRepository.list({ userId })

		return gpgPublicKeys.map(toGpgPublicKeyOutput)
	}

	async delete(userId: UserId, gpgPublicKeyId: GpgPublicKeyId): Promise<void> {
		const deletedId = await this.gpgPublicKeysRepository.delete({
			userId,
			gpgPublicKeyId,
		})

		if (!deletedId)
			throw new GpgPublicKeyNotFoundError({ userId, gpgPublicKeyId })
	}
}
