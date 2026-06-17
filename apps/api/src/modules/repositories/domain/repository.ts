import type { RepositoryWithOwner as RepositoryWithOwnerOutput } from '@repo/contracts'
import type { Repository, RepositoryExternalSource } from '@repo/db'

export interface RepositoryWithOwner extends Repository {
	ownerUser: {
		username: string
	}
	externalSource?: RepositoryExternalSource
}

export interface RepositoryOwnerRow extends Repository {
	ownerUser?: {
		username: string | null
	} | null
	externalSource?: RepositoryExternalSource
}

export function toRepositoryWithOwner(
	repository?: RepositoryOwnerRow
): RepositoryWithOwner | undefined {
	if (!repository?.ownerUser?.username) return undefined

	return {
		...repository,
		ownerUser: { username: repository.ownerUser.username },
	}
}

export function toRepositoryOutput(
	repository: RepositoryWithOwner
): RepositoryWithOwnerOutput {
	return {
		repository: {
			id: repository.id,
			slug: repository.slug,
			name: repository.name,
			visibility: repository.visibility,
			description: repository.description ?? undefined,
			defaultBranch: repository.defaultBranch,
			externalSource: toRepositoryExternalSourceOutput(
				repository.externalSource
			),
			createdAt: repository.createdAt,
			updatedAt: repository.updatedAt,
		},
		owner: {
			username: repository.ownerUser.username,
		},
	}
}

function toRepositoryExternalSourceOutput(
	externalSource: RepositoryExternalSource | null | undefined
): RepositoryWithOwnerOutput['repository']['externalSource'] {
	if (!externalSource) return { mode: 'none' }

	return {
		mode: externalSource.mirrorMode,
		provider: externalSource.provider,
		externalRepositoryId: externalSource.externalRepositoryId.toString(),
		ownerLogin: externalSource.ownerLogin,
		name: externalSource.name,
		fullName: externalSource.fullName,
		sourceUrl: externalSource.sourceUrl,
		sourceDefaultBranch: externalSource.sourceDefaultBranch,
		syncStatus: externalSource.syncStatus,
		lastSyncStartedAt: externalSource.lastSyncStartedAt ?? undefined,
		lastSyncSucceededAt: externalSource.lastSyncSucceededAt ?? undefined,
		lastSyncFailedAt: externalSource.lastSyncFailedAt ?? undefined,
		syncFailureReason: externalSource.syncFailureReason ?? undefined,
		createdAt: externalSource.createdAt,
		updatedAt: externalSource.updatedAt,
	}
}
