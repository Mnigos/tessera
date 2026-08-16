import { ORPCError } from '@orpc/client'

const ORGANIZATION_ERROR_STATUSES = new Set([400, 403, 409, 503])

export function getOrganizationErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof ORPCError)) return fallback

	if (ORGANIZATION_ERROR_STATUSES.has(error.status) && error.message)
		return error.message

	return fallback
}
