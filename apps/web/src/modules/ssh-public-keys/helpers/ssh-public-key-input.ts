import type { CreateSshPublicKeyInput } from '@repo/contracts'

export function getCreateSshPublicKeyInput(formData: FormData) {
	const title = String(formData.get('title') ?? '').trim()
	const publicKey = String(formData.get('publicKey') ?? '').trim()

	return {
		title,
		publicKey,
	} satisfies CreateSshPublicKeyInput
}
