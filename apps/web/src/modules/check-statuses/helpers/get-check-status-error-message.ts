import { ORPCError } from '@orpc/client'

/** Statuses the API answers with a message written for the person reading it. */
const READABLE_ERROR_STATUSES = new Set([400, 404, 409])

export function getCheckStatusErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof ORPCError)) return fallback

	return READABLE_ERROR_STATUSES.has(error.status) && error.message
		? error.message
		: fallback
}
