import { APIError } from 'better-auth/api'

export type IsHandleTaken = (handle: string) => Promise<boolean>

export const ORGANIZATION_SLUG_TAKEN_BY_USER_CODE =
	'ORGANIZATION_SLUG_TAKEN_BY_USER'

// Application-level only; TES-61 adds the database guarantee.
export async function assertOrganizationSlugNotUserHandle(
	slug: string | undefined,
	isUserHandleTaken: IsHandleTaken
) {
	if (!slug) return

	if (await isUserHandleTaken(slug.toLowerCase()))
		throw new APIError('BAD_REQUEST', {
			code: ORGANIZATION_SLUG_TAKEN_BY_USER_CODE,
			message: 'This organization slug is already taken by a user.',
		})
}
