import { ORPCError } from '@orpc/client'

/** A repository row exists while its Git storage is still being prepared. */
export function isRepositoryNotReadyError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.status === 404 &&
		error.message === 'repository not found while storage is being prepared'
	)
}
