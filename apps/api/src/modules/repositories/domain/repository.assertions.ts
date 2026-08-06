import type { RepositoryId } from '@repo/domain'
import type { RepositoryWithOwner } from './repository'
import {
	RepositoryGitHubPushBackInProgressError,
	RepositoryGitHubPushBackUnavailableError,
	RepositoryGitHubSourceOfTruthWriteForbiddenError,
	RepositoryStoragePathMissingError,
} from './repository.errors'

interface RepositoryStorageTarget {
	id: RepositoryId
	storagePath: string | null
}

interface TesseraWriteExternalSource {
	mirrorMode: string
	provider: string
}

interface TesseraWriteTarget {
	id: RepositoryId
	externalSource?: TesseraWriteExternalSource | null
}

function isGitHubSourceOfTruth(
	repository: TesseraWriteTarget
): repository is TesseraWriteTarget & {
	externalSource: TesseraWriteExternalSource
} {
	return repository.externalSource?.mirrorMode === 'github_to_tessera'
}

export function allowsTesseraWrites(repository: TesseraWriteTarget): boolean {
	return !isGitHubSourceOfTruth(repository)
}

export function assertTesseraWritesAllowed(
	repository: TesseraWriteTarget
): void {
	if (!isGitHubSourceOfTruth(repository)) return

	throw new RepositoryGitHubSourceOfTruthWriteForbiddenError({
		repositoryId: repository.id,
		provider: repository.externalSource.provider,
		mirrorMode: repository.externalSource.mirrorMode,
	})
}

export function assertGitHubPushBackAvailable(
	repository: RepositoryWithOwner
): void {
	if (
		repository.externalSource?.provider === 'github' &&
		repository.externalSource.mirrorMode === 'tessera_source'
	)
		return

	throw new RepositoryGitHubPushBackUnavailableError({
		repositoryId: repository.id,
		provider: repository.externalSource?.provider,
		mirrorMode: repository.externalSource?.mirrorMode,
	})
}

export function assertGitHubPushBackNotRunning(
	repository: RepositoryWithOwner
): void {
	if (repository.externalSource?.githubPushBackStatus !== 'running') return

	throw new RepositoryGitHubPushBackInProgressError({
		repositoryId: repository.id,
	})
}

export function assertRepositoryHasStoragePath<
	T extends RepositoryStorageTarget,
>(repository: T): asserts repository is T & { storagePath: string } {
	if (repository.storagePath) return

	throw new RepositoryStoragePathMissingError({
		repositoryId: repository.id,
	})
}
