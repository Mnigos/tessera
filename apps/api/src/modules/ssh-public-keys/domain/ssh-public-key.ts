import type { SshPublicKey as SshPublicKeyOutput } from '@repo/contracts'
import type { SshPublicKey } from '@repo/db'

export function toSshPublicKeyOutput(
	sshPublicKey: SshPublicKey
): SshPublicKeyOutput {
	return {
		id: sshPublicKey.id,
		title: sshPublicKey.title,
		keyType: sshPublicKey.keyType,
		publicKey: sshPublicKey.publicKey,
		fingerprint: sshPublicKey.fingerprint,
		comment: sshPublicKey.comment ?? undefined,
		lastUsedAt: sshPublicKey.lastUsedAt ?? undefined,
		createdAt: sshPublicKey.createdAt,
		updatedAt: sshPublicKey.updatedAt,
	}
}
