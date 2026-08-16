import { ORPCError } from '@orpc/client'

/**
 * Statuses whose message the API writes for a reader: a taken handle, a GitHub
 * login nobody here can claim, an organization that still owns repositories, a
 * lookup GitHub would not answer. Anything else gets the caller's fallback,
 * because an unexpected failure has no copy worth showing.
 */
const ORGANIZATION_ERROR_STATUSES = new Set([400, 403, 409, 503])

export function getOrganizationErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof ORPCError)) return fallback

	if (ORGANIZATION_ERROR_STATUSES.has(error.status) && error.message)
		return error.message

	return fallback
}
