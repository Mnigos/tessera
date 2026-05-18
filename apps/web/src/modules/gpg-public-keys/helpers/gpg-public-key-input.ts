import type { CreateGpgPublicKeyInput } from '@repo/contracts'

export function getCreateGpgPublicKeyInput(formData: FormData) {
	const title = String(formData.get('title') ?? '').trim()
	const publicKey = String(formData.get('publicKey') ?? '').trim()

	return {
		title,
		publicKey,
	} satisfies CreateGpgPublicKeyInput
}
