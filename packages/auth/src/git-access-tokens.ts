import {
	type GitAccessTokenPermission,
	gitAccessTokenPermissions,
} from '@repo/domain'

export const GIT_ACCESS_TOKEN_CONFIG_ID = 'git-access-tokens'
export const GIT_ACCESS_TOKEN_PREFIX = 'tes_git_'

const [gitReadPermission, gitWritePermission] = gitAccessTokenPermissions
export const GIT_ACCESS_TOKEN_DEFAULT_PERMISSION = gitReadPermission

export const GIT_ACCESS_TOKEN_PERMISSION_MAPPING = {
	[gitReadPermission]: { git: ['read'] },
	[gitWritePermission]: { git: ['read', 'write'] },
} as const satisfies Record<
	GitAccessTokenPermission,
	Record<string, readonly string[]>
>

export const GIT_ACCESS_TOKEN_PERMISSIONS = GIT_ACCESS_TOKEN_PERMISSION_MAPPING

export type { GitAccessTokenPermission }

export function getGitAccessTokenPermission(
	permission: GitAccessTokenPermission
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(GIT_ACCESS_TOKEN_PERMISSION_MAPPING[permission]).map(
			([resource, actions]) => [resource, [...actions]]
		)
	)
}
