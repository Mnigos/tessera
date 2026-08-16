import type { BetterAuthPlugin } from 'better-auth'

const TRAILING_SLASHES = /\/+$/

const BLOCKED_ORGANIZATION_PATHS = [
	'/organization/accept-invitation',
	'/organization/cancel-invitation',
	'/organization/create',
	'/organization/delete',
	// Reads that return invitation emails to any member; Tessera serves them
	// through an admin/owner-gated procedure instead.
	'/organization/get-full-organization',
	'/organization/invite-member',
	'/organization/leave',
	'/organization/list-invitations',
	'/organization/reject-invitation',
	'/organization/remove-member',
	'/organization/set-active',
	'/organization/update',
	'/organization/update-member-role',
]

// These routes carry Tessera rules Better Auth cannot know, so they are managed
// only through our own procedures, which reach the same endpoints in-process.
// 404 rather than 403 keeps them from advertising that they exist.
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

// Suffix-matched because the router is mounted under a configurable base path.
function isBlockedOrganizationPath(pathname: string): boolean {
	const normalized = pathname.replace(TRAILING_SLASHES, '')

	return BLOCKED_ORGANIZATION_PATHS.some(path => normalized.endsWith(path))
}
