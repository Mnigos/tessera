import type {
	CreateGitAccessTokenInput,
	GitAccessTokenPermission,
} from '@repo/contracts'
import { gitAccessTokenPermissions } from '@repo/domain'

export function getCreateGitAccessTokenInput(formData: FormData) {
	const name = String(formData.get('name') ?? '').trim()
	const selectedPermissions = formData.getAll('permissions')
	const permissions = gitAccessTokenPermissions.filter(permission =>
		selectedPermissions.includes(permission)
	)

	if (permissions.length === 0) return undefined

	return {
		name: name || undefined,
		permissions: permissions as [
			GitAccessTokenPermission,
			...GitAccessTokenPermission[],
		],
	} satisfies CreateGitAccessTokenInput
}
