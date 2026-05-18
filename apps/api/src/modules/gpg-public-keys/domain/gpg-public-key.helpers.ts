import type { GpgPublicKeyIdentity } from '@repo/db'
import { readKey } from 'openpgp'
import { InvalidGpgPublicKeyError } from './gpg-public-key.errors'

const PRIVATE_KEY_HEADER_REGEX = /-----BEGIN PGP PRIVATE KEY BLOCK-----/
const EMAIL_REGEX = /<([^<>@\s]+@[^<>\s]+)>/

export interface NormalizedGpgPublicKey {
	publicKey: string
	fingerprint: string
	keyId: string
	identities: GpgPublicKeyIdentity[]
	emails: string[]
	keyCreatedAt: Date
	keyExpiresAt: Date | undefined
	isRevoked: boolean
}

export async function normalizeGpgPublicKey(
	input: string
): Promise<NormalizedGpgPublicKey> {
	const trimmedInput = input.trim()

	if (PRIVATE_KEY_HEADER_REGEX.test(trimmedInput))
		throw new InvalidGpgPublicKeyError({ reason: 'private_key_provided' })

	try {
		const key = await readKey({ armoredKey: trimmedInput })

		if (key.isPrivate())
			throw new InvalidGpgPublicKeyError({ reason: 'private_key_provided' })

		const publicKey = key.armor()
		const expirationTime = await key.getExpirationTime()
		const identities = extractIdentities(key.users.map(user => user.userID))

		return {
			publicKey,
			fingerprint: key.getFingerprint().toUpperCase(),
			keyId: key.getKeyID().toHex().toUpperCase(),
			identities,
			emails: [
				...new Set(identities.flatMap(identity => identity.email ?? [])),
			],
			keyCreatedAt: key.getCreationTime(),
			keyExpiresAt: expirationTime instanceof Date ? expirationTime : undefined,
			isRevoked: await key.isRevoked(),
		}
	} catch (error) {
		if (error instanceof InvalidGpgPublicKeyError) throw error

		throw new InvalidGpgPublicKeyError({
			reason: 'malformed_or_invalid_public_key',
		})
	}
}

interface OpenPgpUserId {
	name: string
	email: string
	comment: string
	userID: string
}

function extractIdentities(
	userIds: (OpenPgpUserId | null)[]
): GpgPublicKeyIdentity[] {
	return userIds
		.filter(userId => userId !== null)
		.map(userId => ({
			name: userId.name || undefined,
			email: userId.email || extractEmail(userId.userID),
			comment: userId.comment || undefined,
			userId: userId.userID,
		}))
}

function extractEmail(userId: string): string | undefined {
	return EMAIL_REGEX.exec(userId)?.[1]
}
