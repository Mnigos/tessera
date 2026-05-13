export const gitAccessTokenPermissions = ['git:read', 'git:write'] as const

export type GitAccessTokenPermission =
	(typeof gitAccessTokenPermissions)[number]
