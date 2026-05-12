import type { RepositoryWithOwner as RepositoryWithOwnerOutput } from '@repo/contracts'
import type { Repository } from '@repo/db'

export interface RepositoryWithOwner extends Repository {
	ownerUser: {
		username: string
	}
}

interface RepositoryOwnerRow extends Repository {
	ownerUser?: {
		username: string | null
	} | null
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
			storagePath: repository.storagePath ?? undefined,
			createdAt: repository.createdAt,
			updatedAt: repository.updatedAt,
		},
		owner: {
			username: repository.ownerUser.username,
		},
	}
}
