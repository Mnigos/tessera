import { oc } from '@orpc/contract'
import type { SshPublicKeyId } from '@repo/domain'
import { z } from 'zod'

export const sshPublicKeySchema = z.object({
	id: z.uuid().brand<'ssh_public_key_id'>(),
	title: z.string(),
	keyType: z.string(),
	publicKey: z.string(),
	fingerprintSha256: z.string(),
	comment: z.string().optional(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export interface SshPublicKey
	extends Omit<z.infer<typeof sshPublicKeySchema>, 'id'> {
	id: SshPublicKeyId
}

export const createSshPublicKeyInputSchema = z.object({
	title: z.string().trim().min(1).max(100),
	publicKey: z.string().trim().min(1).max(8192),
})
export type CreateSshPublicKeyInput = z.input<
	typeof createSshPublicKeyInputSchema
>

export const sshPublicKeyIdInputSchema = z.object({
	id: z.uuid().brand<'ssh_public_key_id'>(),
})
export interface SshPublicKeyIdInput {
	id: SshPublicKeyId
}

export const sshPublicKeysContract = {
	create: oc
		.route({ method: 'POST', path: '/ssh-public-keys' })
		.input(createSshPublicKeyInputSchema)
		.output(z.object({ sshPublicKey: sshPublicKeySchema })),
	list: oc
		.route({ method: 'GET', path: '/ssh-public-keys' })
		.output(z.object({ sshPublicKeys: z.array(sshPublicKeySchema) })),
	revoke: oc
		.route({ method: 'POST', path: '/ssh-public-keys/{id}/revoke' })
		.input(sshPublicKeyIdInputSchema)
		.output(z.object({ success: z.boolean() })),
	delete: oc
		.route({ method: 'DELETE', path: '/ssh-public-keys/{id}' })
		.input(sshPublicKeyIdInputSchema)
		.output(z.object({ success: z.boolean() })),
}
