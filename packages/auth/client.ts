import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export function createClient(
	baseURL?: string
): ReturnType<typeof createAuthClient> {
	return createAuthClient({
		baseURL:
			baseURL ?? (typeof window !== 'undefined' ? window.location.origin : ''),
		fetchOptions: { credentials: 'include' },
		plugins: [organizationClient()],
	})
}

export const authClient: ReturnType<typeof createAuthClient> = createClient()
