import type { GitAccessToken } from '@repo/contracts'
import type { ApiKey } from '@repo/db'

export function parseRecord(
	value: unknown
): Record<string, string[]> | undefined {
	if (!value) return undefined

	try {
		const parsed =
			typeof value === 'string' ? (JSON.parse(value) as unknown) : value
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return undefined

		const entries = Object.entries(parsed)
		const isValid = entries.every(
			([, actions]) =>
				Array.isArray(actions) &&
				actions.every(action => typeof action === 'string')
		)
		if (!isValid) return undefined

		return parsed as Record<string, string[]>
	} catch {
		return undefined
	}
}

export function toGitAccessTokenOutput(apiKey: ApiKey): GitAccessToken {
	return {
		id: apiKey.id,
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
