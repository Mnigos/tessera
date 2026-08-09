import type { BetterAuthPlugin } from 'better-auth'

const TRAILING_SLASHES = /\/+$/

/**
 * The API-key plugin's own HTTP surface. Better Auth exposes these to any
 * authenticated session, scoped by configuration ID.
 */
const BLOCKED_API_KEY_PATHS = [
	'/api-key/create',
	'/api-key/delete',
	'/api-key/get',
	'/api-key/list',
	'/api-key/update',
]

/**
 * Closes Better Auth's own key-management routes.
 *
 * Every key Tessera issues stands for something Tessera authorizes — a Git
 * token for one user, a status credential for one repository — but Better Auth
 * knows only that a key references the user who happened to create it. Left
 * open, the person who created a repository's CI credential could list it,
 * extend its expiry, or delete it through this surface long after losing the
 * repository access that justified it, and none of it would reach the
 * repository's audit log.
 *
 * So the keys are managed only where that authorization is actually checked:
 * Tessera's own procedures, which reach the same endpoints in-process. Direct
 * server-side `auth.api.*` calls never travel through this hook and are
 * unaffected. Answering 404 rather than 403 keeps the routes from advertising
 * that they exist.
 */
export function apiKeyEndpointLockdown(): BetterAuthPlugin {
	return {
		id: 'api-key-endpoint-lockdown',
		onRequest: (request: Request) => {
			const { pathname } = new URL(request.url)

			return Promise.resolve(
				isBlockedApiKeyPath(pathname)
					? { response: new Response('Not Found', { status: 404 }) }
					: undefined
			)
		},
	}
}

/**
 * Matched by suffix because the router is mounted under a configurable base
 * path, and no other endpoint can end in one of these.
 */
function isBlockedApiKeyPath(pathname: string): boolean {
	const normalized = pathname.replace(TRAILING_SLASHES, '')

	return BLOCKED_API_KEY_PATHS.some(path => normalized.endsWith(path))
}
