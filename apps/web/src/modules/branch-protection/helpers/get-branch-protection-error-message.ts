import { ORPCError } from '@orpc/client'

const BRANCH_PROTECTION_ERROR_STATUSES = new Set([400, 409])

interface BranchProtectionErrorMessages {
	fallback: string
	notFound: string
}

export function getBranchProtectionErrorMessage(
	error: unknown,
	{ fallback, notFound }: BranchProtectionErrorMessages
) {
	if (!(error instanceof ORPCError)) return fallback

	if (error.status === 404) return notFound

	if (BRANCH_PROTECTION_ERROR_STATUSES.has(error.status) && error.message)
		return error.message

	return fallback
}
