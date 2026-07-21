import { APIError } from 'better-auth/api'

export type IsHandleTaken = (handle: string) => Promise<boolean>

/**
 * Rejects organization slugs that would shadow an existing user handle.
 *
 * Users and organizations share the /{handle} URL namespace and a user handle
 * wins deterministically, so an organization must not claim an existing
 * username. Application-level check only; the DB-level cross-namespace
 * guarantee is tracked by TES-61.
 */
export async function assertOrganizationSlugNotUserHandle(
	slug: string | undefined,
	isUserHandleTaken: IsHandleTaken
) {
	if (!slug) return

	if (await isUserHandleTaken(slug.toLowerCase()))
		throw new APIError('BAD_REQUEST', {
			message: 'This organization slug is already taken by a user.',
		})
}
