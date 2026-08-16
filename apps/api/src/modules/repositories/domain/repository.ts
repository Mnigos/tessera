import type {
	RepositoryOwnerKind,
	RepositoryWithOwner as RepositoryWithOwnerOutput,
} from '@repo/contracts'
import type { Repository, RepositoryExternalSource } from '@repo/db'
import type { OrganizationId, UserId } from '@repo/domain'
import {
	type RepositoryCloneBaseUrls,
	toRepositoryCloneUrls,
} from './repository-clone-urls'

export type RepositoryExternalSourceReadModel = Omit<
	RepositoryExternalSource,
	| 'githubPushBackEnabled'
	| 'githubPushBackStatus'
	| 'githubPushBackStartedAt'
	| 'githubPushBackSucceededAt'
	| 'githubPushBackFailedAt'
	| 'githubPushBackFailureReason'
	| 'installationId'
	| 'externalRepositoryNodeId'
	| 'syncFailureCode'
	| 'authorityGeneration'
	| 'requestedSyncVersion'
	| 'requestedSyncTrigger'
	| 'requestedReplayDeliveryId'
	| 'completedSyncVersion'
	| 'pullRequestSyncCursorAt'
	| 'syncLeaseOwner'
	| 'syncLeaseAcquiredAt'
	| 'syncLeaseExpiresAt'
> &
	Partial<
		Pick<
			RepositoryExternalSource,
			| 'githubPushBackEnabled'
			| 'githubPushBackStatus'
			| 'githubPushBackStartedAt'
			| 'githubPushBackSucceededAt'
			| 'githubPushBackFailedAt'
			| 'githubPushBackFailureReason'
		>
	>

/** Exactly one column is set; the repositories check constraint enforces it. */
export interface RepositoryOwnerIdentity {
	ownerUserId: UserId | null
	ownerOrganizationId: OrganizationId | null
}

export interface RepositoryOwner {
	kind: RepositoryOwnerKind
	handle: string
}

export interface RepositoryWithOwner extends Repository {
	owner: RepositoryOwner
	externalSource?: RepositoryExternalSourceReadModel
}

export interface RepositoryOwnerRow extends Repository {
	ownerHandle: string | null
	externalSource?: RepositoryExternalSourceReadModel
}

export function toRepositoryWithOwner(
	row?: RepositoryOwnerRow
): RepositoryWithOwner | undefined {
	if (!row?.ownerHandle) return undefined

	const { ownerHandle, ...repository } = row

	return {
		...repository,
		owner: {
			kind: repository.ownerUserId ? 'user' : 'organization',
			handle: ownerHandle,
		},
	}
}

export function toRepositoryOutput(
	repository: RepositoryWithOwner,
	cloneBaseUrls: RepositoryCloneBaseUrls
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
			cloneUrls: toRepositoryCloneUrls({
				baseUrls: cloneBaseUrls,
				externalSource: repository.externalSource,
				ownerHandle: repository.owner.handle,
				slug: repository.slug,
			}),
			createdAt: repository.createdAt,
			updatedAt: repository.updatedAt,
		},
		owner: {
			...repository.owner,
			username: repository.owner.handle,
		},
	}
}

function toRepositoryExternalSourceOutput(
	externalSource: RepositoryExternalSourceReadModel | null | undefined
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
		nextSyncAt: externalSource.nextSyncAt ?? undefined,
		syncFailureReason: externalSource.syncFailureReason ?? undefined,
		cutoverActorUserId: externalSource.cutoverActorUserId ?? undefined,
		cutoverAt: externalSource.cutoverAt ?? undefined,
		cutoverFromMirrorMode:
			externalSource.cutoverFromMirrorMode === 'github_to_tessera'
				? externalSource.cutoverFromMirrorMode
				: undefined,
		githubPushBackEnabled: externalSource.githubPushBackEnabled ?? false,
		githubPushBackStatus: externalSource.githubPushBackStatus ?? 'idle',
		githubPushBackStartedAt:
			externalSource.githubPushBackStartedAt ?? undefined,
		githubPushBackSucceededAt:
			externalSource.githubPushBackSucceededAt ?? undefined,
		githubPushBackFailedAt: externalSource.githubPushBackFailedAt ?? undefined,
		githubPushBackFailureReason:
			externalSource.githubPushBackFailureReason ?? undefined,
		createdAt: externalSource.createdAt,
		updatedAt: externalSource.updatedAt,
	}
}
