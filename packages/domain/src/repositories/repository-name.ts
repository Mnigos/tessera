import type { Brand } from '../shared/brand'

export type RepositoryName = Brand<string, 'repository_name'>

export const REPOSITORY_NAME_REGEX = /^[a-zA-Z0-9._-]+$/
