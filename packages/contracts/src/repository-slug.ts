import { z } from 'zod'

/**
 * How a repository is named in a path, on its own so that both the repository
 * contract and the contracts routed underneath one can use it.
 *
 * It lives apart from `repositories.contract` because that module reads schemas
 * from the contracts nested beneath it — commit rollups, most immediately — and
 * a primitive those modules also need would otherwise make the two import each
 * other and evaluate in an order where one of them is still empty.
 */
export const repositorySlugSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.brand<'repository_slug'>()
export type RepositorySlug = z.infer<typeof repositorySlugSchema>
