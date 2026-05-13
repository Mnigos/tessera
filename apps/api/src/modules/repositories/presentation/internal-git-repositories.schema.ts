import { repositorySlugSchema } from '@repo/contracts'
import { z } from 'zod'

export const authorizeGitRepositoryReadInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})

export type AuthorizeGitRepositoryReadInput = z.infer<
	typeof authorizeGitRepositoryReadInputSchema
>
