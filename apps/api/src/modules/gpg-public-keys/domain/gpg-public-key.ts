import type { GpgPublicKey as GpgPublicKeyOutput } from '@repo/contracts'
import type { GpgPublicKey } from '@repo/db'

export function toGpgPublicKeyOutput(
	gpgPublicKey: GpgPublicKey
): GpgPublicKeyOutput {
	return {
		id: gpgPublicKey.id,
		title: gpgPublicKey.title,
		publicKey: gpgPublicKey.publicKey,
		fingerprint: gpgPublicKey.fingerprint,
		keyId: gpgPublicKey.keyId,
		identities: gpgPublicKey.identities,
		emails: gpgPublicKey.emails,
		keyCreatedAt: gpgPublicKey.keyCreatedAt,
		keyExpiresAt: gpgPublicKey.keyExpiresAt ?? undefined,
		isRevoked: gpgPublicKey.isRevoked,
		lastUsedAt: gpgPublicKey.lastUsedAt ?? undefined,
		createdAt: gpgPublicKey.createdAt,
		updatedAt: gpgPublicKey.updatedAt,
	}
}
