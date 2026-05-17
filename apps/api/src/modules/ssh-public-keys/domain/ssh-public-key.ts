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
		fingerprintSha256: sshPublicKey.fingerprintSha256,
		comment: sshPublicKey.comment ?? undefined,
		createdAt: sshPublicKey.createdAt,
		updatedAt: sshPublicKey.updatedAt,
	}
}
