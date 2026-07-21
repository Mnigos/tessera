import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	type DrizzleTransaction,
	eq,
	type RepositoryEvent,
	type RepositoryEventPayload,
	repositoryCollaborators,
	repositoryEvents,
	user,
} from '@repo/db'
import type {
	RepositoryCollaboratorRole,
	RepositoryId,
	UserId,
} from '@repo/domain'
import type { RepositoryCollaboratorView } from '../domain/repository-collaborator'

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface CollaboratorMutationParams extends RepositoryParams {
	userId: UserId
	actorUserId: UserId
}

interface AddParams extends CollaboratorMutationParams {
	role: RepositoryCollaboratorRole
}

interface UpdateRoleParams extends CollaboratorMutationParams {
	role: RepositoryCollaboratorRole
}

type RepositoryCollaboratorMutationRow = Omit<
	RepositoryCollaboratorView,
	'username'
>

type CollaboratorDatabase = Database | DrizzleTransaction

const COLLABORATOR_MUTATION_COLUMNS = {
	userId: repositoryCollaborators.userId,
	role: repositoryCollaborators.role,
	createdAt: repositoryCollaborators.createdAt,
}

@Injectable()
export class RepositoryCollaboratorsRepository {
	constructor(private readonly db: Database) {}

	async list({
		repositoryId,
	}: RepositoryParams): Promise<RepositoryCollaboratorView[]> {
		const rows = await this.db
			.select({
				userId: repositoryCollaborators.userId,
				username: user.username,
				role: repositoryCollaborators.role,
				createdAt: repositoryCollaborators.createdAt,
			})
			.from(repositoryCollaborators)
			.innerJoin(user, eq(repositoryCollaborators.userId, user.id))
			.where(eq(repositoryCollaborators.repositoryId, repositoryId))
			.orderBy(asc(repositoryCollaborators.createdAt))

		return rows.flatMap(({ username, ...row }) =>
			username ? [{ ...row, username }] : []
		)
	}

	async add({
		actorUserId,
		repositoryId,
		role,
		userId,
	}: AddParams): Promise<RepositoryCollaboratorMutationRow | undefined> {
		return await this.db.transaction(async tx => {
			const [collaborator] = await tx
				.insert(repositoryCollaborators)
				.values({ repositoryId, userId, role })
				.returning(COLLABORATOR_MUTATION_COLUMNS)

			if (!collaborator) return undefined

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'collaborator_added',
				payload: {
					type: 'collaborator_added',
					collaboratorUserId: userId,
					role,
				},
			})

			return collaborator
		})
	}

	async updateRole({
		actorUserId,
		repositoryId,
		role,
		userId,
	}: UpdateRoleParams): Promise<RepositoryCollaboratorMutationRow | undefined> {
		return await this.db.transaction(async tx => {
			const [existing] = await tx
				.select({ role: repositoryCollaborators.role })
				.from(repositoryCollaborators)
				.where(
					and(
						eq(repositoryCollaborators.repositoryId, repositoryId),
						eq(repositoryCollaborators.userId, userId)
					)
				)
				.for('update')

			if (!existing) return undefined

			if (existing.role === role) {
				const [unchanged] = await tx
					.select(COLLABORATOR_MUTATION_COLUMNS)
					.from(repositoryCollaborators)
					.where(
						and(
							eq(repositoryCollaborators.repositoryId, repositoryId),
							eq(repositoryCollaborators.userId, userId)
						)
					)

				return unchanged
			}

			const [collaborator] = await tx
				.update(repositoryCollaborators)
				.set({ role })
				.where(
					and(
						eq(repositoryCollaborators.repositoryId, repositoryId),
						eq(repositoryCollaborators.userId, userId)
					)
				)
				.returning(COLLABORATOR_MUTATION_COLUMNS)

			if (!collaborator) return undefined

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'collaborator_role_changed',
				payload: {
					type: 'collaborator_role_changed',
					collaboratorUserId: userId,
					previousRole: existing.role,
					role,
				},
			})

			return collaborator
		})
	}

	async remove({
		actorUserId,
		repositoryId,
		userId,
	}: CollaboratorMutationParams): Promise<boolean> {
		return await this.db.transaction(async tx => {
			const [removed] = await tx
				.delete(repositoryCollaborators)
				.where(
					and(
						eq(repositoryCollaborators.repositoryId, repositoryId),
						eq(repositoryCollaborators.userId, userId)
					)
				)
				.returning({ role: repositoryCollaborators.role })

			if (!removed) return false

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'collaborator_removed',
				payload: {
					type: 'collaborator_removed',
					collaboratorUserId: userId,
					role: removed.role,
				},
			})

			return true
		})
	}

	private async createEvent(
		db: CollaboratorDatabase,
		params: {
			repositoryId: RepositoryId
			actorUserId: UserId
			type: RepositoryEvent['type']
			payload: RepositoryEventPayload
		}
	) {
		await db.insert(repositoryEvents).values(params)
	}
}
