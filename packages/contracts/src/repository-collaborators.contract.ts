import { oc } from '@orpc/contract'
import { repositoryCollaboratorRoles } from '@repo/domain'
import { z } from 'zod'
import { repositorySlugSchema } from './repositories.contract'

export const repositoryCollaboratorRoleSchema = z.enum(
	repositoryCollaboratorRoles
)
export type RepositoryCollaboratorRole = z.infer<
	typeof repositoryCollaboratorRoleSchema
>

export const repositoryCollaboratorSchema = z.object({
	userId: z.uuid().brand<'user_id'>(),
	username: z.string().min(1),
	role: repositoryCollaboratorRoleSchema,
	createdAt: z.coerce.date(),
})
export type RepositoryCollaborator = z.infer<
	typeof repositoryCollaboratorSchema
>

const repositoryCollaboratorsInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})

const repositoryCollaboratorInputSchema =
	repositoryCollaboratorsInputSchema.extend({
		collaboratorUsername: z.string().min(1),
	})

export const listRepositoryCollaboratorsInputSchema =
	repositoryCollaboratorsInputSchema
export type ListRepositoryCollaboratorsInput = z.input<
	typeof listRepositoryCollaboratorsInputSchema
>
export type ParsedListRepositoryCollaboratorsInput = z.infer<
	typeof listRepositoryCollaboratorsInputSchema
>

export const addRepositoryCollaboratorInputSchema =
	repositoryCollaboratorsInputSchema.extend({
		collaboratorUsername: z.string().trim().min(1),
		role: repositoryCollaboratorRoleSchema,
	})
export type AddRepositoryCollaboratorInput = z.input<
	typeof addRepositoryCollaboratorInputSchema
>
export type ParsedAddRepositoryCollaboratorInput = z.infer<
	typeof addRepositoryCollaboratorInputSchema
>

export const updateRepositoryCollaboratorRoleInputSchema =
	repositoryCollaboratorInputSchema.extend({
		role: repositoryCollaboratorRoleSchema,
	})
export type UpdateRepositoryCollaboratorRoleInput = z.input<
	typeof updateRepositoryCollaboratorRoleInputSchema
>
export type ParsedUpdateRepositoryCollaboratorRoleInput = z.infer<
	typeof updateRepositoryCollaboratorRoleInputSchema
>

export const removeRepositoryCollaboratorInputSchema =
	repositoryCollaboratorInputSchema
export type RemoveRepositoryCollaboratorInput = z.input<
	typeof removeRepositoryCollaboratorInputSchema
>
export type ParsedRemoveRepositoryCollaboratorInput = z.infer<
	typeof removeRepositoryCollaboratorInputSchema
>

export const repositoryCollaboratorsContract = {
	list: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/collaborators',
		})
		.input(listRepositoryCollaboratorsInputSchema)
		.output(z.object({ collaborators: z.array(repositoryCollaboratorSchema) })),
	add: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/collaborators',
		})
		.input(addRepositoryCollaboratorInputSchema)
		.output(repositoryCollaboratorSchema),
	updateRole: oc
		.route({
			method: 'PATCH',
			path: '/repositories/{username}/{slug}/collaborators/{collaboratorUsername}',
		})
		.input(updateRepositoryCollaboratorRoleInputSchema)
		.output(repositoryCollaboratorSchema),
	remove: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/collaborators/{collaboratorUsername}',
		})
		.input(removeRepositoryCollaboratorInputSchema)
		.output(z.object({ success: z.boolean() })),
}
