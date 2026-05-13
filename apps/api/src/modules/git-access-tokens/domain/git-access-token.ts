import type { GitAccessToken } from '@repo/contracts'
import type { ApiKey } from '@repo/db'

type GitAccessTokenId = GitAccessToken['id']

function parseRecord(
	value: string | null
): Record<string, string[]> | undefined {
	if (!value) return undefined

	try {
		const parsed = JSON.parse(value) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return undefined

		return parsed as Record<string, string[]>
	} catch {
		return undefined
	}
}

export function toGitAccessTokenOutput(apiKey: ApiKey): GitAccessToken {
	return {
		id: apiKey.id as GitAccessTokenId,
		name: apiKey.name ?? undefined,
		prefix: apiKey.prefix ?? undefined,
		start: apiKey.start ?? undefined,
		enabled: apiKey.enabled ?? false,
		permissions: parseRecord(apiKey.permissions),
		expiresAt: apiKey.expiresAt ?? undefined,
		lastRequest: apiKey.lastRequest ?? undefined,
		createdAt: apiKey.createdAt,
		updatedAt: apiKey.updatedAt,
	}
}
