import { oc } from '@orpc/contract'
import { z } from 'zod'

export const repositorySchema = z.object({
	id: z.uuid().brand<'repository_id'>(),
	ownerSlug: z.string(),
	name: z.string(),
	visibility: z.enum(['public', 'private']),
	description: z.string().optional(),
	updatedAt: z.coerce.date(),
})
export type Repository = z.infer<typeof repositorySchema>

export const repositoriesContract = {
	listForViewer: oc
		.route({ method: 'GET', path: '/repositories' })
		.output(z.object({ repositories: z.array(repositorySchema) })),
}
