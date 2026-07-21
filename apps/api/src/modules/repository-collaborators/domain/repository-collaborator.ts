import type { RepositoryCollaborator as RepositoryCollaboratorOutput } from '@repo/contracts'
import type { RepositoryCollaboratorRole, UserId } from '@repo/domain'

export interface RepositoryCollaboratorView {
	userId: UserId
	username: string
	role: RepositoryCollaboratorRole
	createdAt: Date
}

export function toRepositoryCollaboratorOutput(
	collaborator: RepositoryCollaboratorView
): RepositoryCollaboratorOutput {
	return {
		userId: collaborator.userId,
		username: collaborator.username,
		role: collaborator.role,
		createdAt: collaborator.createdAt,
	}
}
