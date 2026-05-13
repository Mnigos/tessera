import {
	type GitAccessTokenPermission,
	getGitAccessTokenPermission,
} from '@repo/auth'
import type { CreateGitAccessTokenInput } from '@repo/contracts'

type CreateGitAccessTokenPermissions = CreateGitAccessTokenInput['permissions']

export function hasGitAccessTokenPermission(
	permissions: Record<string, string[]>,
	requiredPermission: GitAccessTokenPermission
) {
	const grantedActions = permissions.git ?? []
	if (requiredPermission === 'git:read') return grantedActions.includes('read')

	return grantedActions.includes('write')
}

export function toBetterAuthGitAccessTokenPermissions(
	permissions: CreateGitAccessTokenPermissions
) {
	if (permissions.includes('git:write'))
		return getGitAccessTokenPermission('git:write')

	return getGitAccessTokenPermission('git:read')
}
