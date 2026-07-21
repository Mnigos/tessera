import { RepositoriesService } from '@modules/repositories'
import { UserService } from '@modules/user'
import { Injectable } from '@nestjs/common'
import type {
	ParsedAddRepositoryCollaboratorInput,
	ParsedListRepositoryCollaboratorsInput,
	ParsedRemoveRepositoryCollaboratorInput,
	ParsedUpdateRepositoryCollaboratorRoleInput,
	RepositoryCollaborator,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { toRepositoryCollaboratorOutput } from '../domain/repository-collaborator'
import {
	RepositoryCollaboratorAlreadyExistsError,
	RepositoryCollaboratorNotFoundError,
	RepositoryCollaboratorOwnerError,
} from '../domain/repository-collaborator.errors'
import { RepositoryCollaboratorsRepository } from '../infrastructure/repository-collaborators.repository'

const REPOSITORY_COLLABORATOR_UNIQUE_CONSTRAINTS = new Set([
	'repository_collaborators_repository_user_unique',
])

@Injectable()
export class RepositoryCollaboratorsService {
	constructor(
		private readonly repositoryCollaboratorsRepository: RepositoryCollaboratorsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly userService: UserService
	) {}

	async list(
		viewerUserId: UserId,
		{ slug, username }: ParsedListRepositoryCollaboratorsInput
	): Promise<RepositoryCollaborator[]> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const collaborators = await this.repositoryCollaboratorsRepository.list({
			repositoryId,
		})

		return collaborators.map(toRepositoryCollaboratorOutput)
	}

	async add(
		actorUserId: UserId,
		{
			collaboratorUsername,
			role,
			slug,
			username,
		}: ParsedAddRepositoryCollaboratorInput
	): Promise<RepositoryCollaborator> {
		const { repositoryId, ownerUserId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const collaboratorUserId = await this.userService.findUserId({
			username: collaboratorUsername,
		})

		if (ownerUserId && ownerUserId === collaboratorUserId)
			throw new RepositoryCollaboratorOwnerError({
				repositoryId,
				collaboratorUsername,
			})

		try {
			const collaborator = await this.repositoryCollaboratorsRepository.add({
				repositoryId,
				userId: collaboratorUserId,
				role,
				actorUserId,
			})

			if (!collaborator)
				throw new RepositoryCollaboratorNotFoundError({
					repositoryId,
					collaboratorUsername,
				})

			return toRepositoryCollaboratorOutput({
				...collaborator,
				username: collaboratorUsername,
			})
		} catch (error) {
			if (isUniqueViolation(error, REPOSITORY_COLLABORATOR_UNIQUE_CONSTRAINTS))
				throw new RepositoryCollaboratorAlreadyExistsError({
					repositoryId,
					collaboratorUsername,
				})

			throw error
		}
	}

	async updateRole(
		actorUserId: UserId,
		{
			collaboratorUsername,
			role,
			slug,
			username,
		}: ParsedUpdateRepositoryCollaboratorRoleInput
	): Promise<RepositoryCollaborator> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const collaboratorUserId = await this.userService.findUserId({
			username: collaboratorUsername,
		})
		const collaborator =
			await this.repositoryCollaboratorsRepository.updateRole({
				repositoryId,
				userId: collaboratorUserId,
				role,
				actorUserId,
			})

		if (!collaborator)
			throw new RepositoryCollaboratorNotFoundError({
				repositoryId,
				collaboratorUsername,
			})

		return toRepositoryCollaboratorOutput({
			...collaborator,
			username: collaboratorUsername,
		})
	}

	async remove(
		actorUserId: UserId,
		{
			collaboratorUsername,
			slug,
			username,
		}: ParsedRemoveRepositoryCollaboratorInput
	): Promise<{ success: boolean }> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const collaboratorUserId = await this.userService.findUserId({
			username: collaboratorUsername,
		})
		const removed = await this.repositoryCollaboratorsRepository.remove({
			repositoryId,
			userId: collaboratorUserId,
			actorUserId,
		})

		if (!removed)
			throw new RepositoryCollaboratorNotFoundError({
				repositoryId,
				collaboratorUsername,
			})

		return { success: true }
	}
}
