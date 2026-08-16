import type { BetterAuthPlugin } from 'better-auth'

const TRAILING_SLASHES = /\/+$/

/**
 * The organization plugin's own mutation surface. Better Auth exposes each of
 * these to any authenticated session that satisfies its role check.
 */
const BLOCKED_ORGANIZATION_PATHS = [
	'/organization/accept-invitation',
	'/organization/cancel-invitation',
	'/organization/create',
	'/organization/delete',
	'/organization/invite-member',
	'/organization/leave',
	'/organization/reject-invitation',
	'/organization/remove-member',
	'/organization/set-active',
	'/organization/update',
	'/organization/update-member-role',
]

/**
 * Closes Better Auth's own organization-mutation routes.
 *
 * Every one of these decisions carries a Tessera rule Better Auth has no way to
 * know: a handle must be free in the user namespace and unclaimed on GitHub
 * before an organization can answer to it, and an organization that still owns
 * repositories must not be deleted at all — the plugin never asks what an
 * organization owns, and the restricting foreign key would refuse the delete
 * only after the plugin had already removed every member and invitation in
 * separate statements outside a transaction. Left open, `/organization/create`
 * and `/organization/update` would hand out handles the create form refuses,
 * and `/organization/delete` would be a way around the repository check rather
 * than a way through it.
 *
 * So organizations are managed only where those rules are actually applied:
 * Tessera's own procedures, which reach the same endpoints in-process. Direct
 * server-side `auth.api.*` calls never travel through this hook and are
 * unaffected. Read routes stay open — they enforce membership themselves and
 * decide nothing. Answering 404 rather than 403 keeps the routes from
 * advertising that they exist.
 */
export function organizationEndpointLockdown(): BetterAuthPlugin {
	return {
		id: 'organization-endpoint-lockdown',
		onRequest: (request: Request) => {
			const { pathname } = new URL(request.url)

			return Promise.resolve(
				isBlockedOrganizationPath(pathname)
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
function isBlockedOrganizationPath(pathname: string): boolean {
	const normalized = pathname.replace(TRAILING_SLASHES, '')

	return BLOCKED_ORGANIZATION_PATHS.some(path => normalized.endsWith(path))
}
