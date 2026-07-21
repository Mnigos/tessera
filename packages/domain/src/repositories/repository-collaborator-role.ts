export const repositoryCollaboratorRoles = ['read', 'write', 'admin'] as const

export type RepositoryCollaboratorRole =
	(typeof repositoryCollaboratorRoles)[number]
