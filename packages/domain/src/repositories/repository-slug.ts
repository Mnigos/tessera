import type { Brand } from '../shared/brand'

export type RepositorySlug = Brand<string, 'repository_slug'>

export const REPOSITORY_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
