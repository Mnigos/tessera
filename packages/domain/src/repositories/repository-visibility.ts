export const repositoryVisibilities = ['public', 'private'] as const

export type RepositoryVisibility = (typeof repositoryVisibilities)[number]
