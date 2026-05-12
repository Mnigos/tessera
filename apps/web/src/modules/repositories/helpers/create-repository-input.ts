import type { CreateRepositoryInput } from '@repo/contracts'

export function getCreateRepositoryInput(formData: FormData) {
	const name = String(formData.get('name') ?? '').trim()
	const slug = String(formData.get('slug') ?? '').trim()
	const description = String(formData.get('description') ?? '').trim()
	const visibilityValue = formData.get('visibility')
	const visibility = visibilityValue === 'public' ? 'public' : 'private'

	return {
		name,
		slug: slug || undefined,
		description: description || undefined,
		visibility,
	} satisfies CreateRepositoryInput
}
