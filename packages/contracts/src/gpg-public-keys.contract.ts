import { oc } from '@orpc/contract'
import type { GpgPublicKeyId } from '@repo/domain'
import { z } from 'zod'

const optionalDateSchema = z
	.preprocess(
		value => (typeof value === 'string' ? new Date(value) : value),
		z.date()
	)
	.optional()

export const gpgPublicKeyIdentitySchema = z.object({
	name: z.string().optional(),
	email: z.string().optional(),
	comment: z.string().optional(),
	userId: z.string(),
})

export const gpgPublicKeySchema = z.object({
	id: z.uuid().brand<'gpg_public_key_id'>(),
	title: z.string(),
	publicKey: z.string(),
	fingerprint: z.string(),
	keyId: z.string(),
	identities: z.array(gpgPublicKeyIdentitySchema),
	emails: z.array(z.string()),
	keyCreatedAt: z.coerce.date(),
	keyExpiresAt: optionalDateSchema,
	isRevoked: z.boolean(),
	lastUsedAt: optionalDateSchema,
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export interface GpgPublicKey
	extends Omit<z.infer<typeof gpgPublicKeySchema>, 'id'> {
	id: GpgPublicKeyId
}

export const createGpgPublicKeyInputSchema = z.object({
	title: z.string().trim().min(1).max(100),
	publicKey: z.string().trim().min(1).max(65_536),
})
export type CreateGpgPublicKeyInput = z.input<
	typeof createGpgPublicKeyInputSchema
>

export const gpgPublicKeyIdInputSchema = z.object({
	id: z.uuid().brand<'gpg_public_key_id'>(),
})
export interface GpgPublicKeyIdInput {
	id: GpgPublicKeyId
}

export const gpgPublicKeysContract = {
	create: oc
		.route({ method: 'POST', path: '/gpg-public-keys' })
		.input(createGpgPublicKeyInputSchema)
		.output(z.object({ gpgPublicKey: gpgPublicKeySchema })),
	list: oc
		.route({ method: 'GET', path: '/gpg-public-keys' })
		.output(z.object({ gpgPublicKeys: z.array(gpgPublicKeySchema) })),
	delete: oc
		.route({ method: 'DELETE', path: '/gpg-public-keys/{id}' })
		.input(gpgPublicKeyIdInputSchema)
		.output(z.object({ success: z.boolean() })),
}
