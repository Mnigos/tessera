import type { Brand } from '../shared/brand'

export type ApiKeyId = Brand<string, 'apikey_id'>

export const gitAccessTokenPermissions = ['git:read', 'git:write'] as const

export type GitAccessTokenPermission =
	(typeof gitAccessTokenPermissions)[number]
