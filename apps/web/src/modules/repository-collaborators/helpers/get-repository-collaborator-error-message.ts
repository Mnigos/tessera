import { ORPCError } from '@orpc/client'

const REPOSITORY_COLLABORATOR_ERROR_STATUSES = new Set([400, 409])

interface RepositoryCollaboratorErrorMessages {
	fallback: string
	notFound: string
}

export function getRepositoryCollaboratorErrorMessage(
	error: unknown,
	{ fallback, notFound }: RepositoryCollaboratorErrorMessages
) {
	if (!(error instanceof ORPCError)) return fallback

	if (error.status === 404) return notFound

	if (REPOSITORY_COLLABORATOR_ERROR_STATUSES.has(error.status) && error.message)
		return error.message

	return fallback
}
