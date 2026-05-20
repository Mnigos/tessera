import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { GitHubImportRepository as GitHubRepositoryMetadata } from '@repo/contracts'
import {
	account,
	and,
	desc,
	eq,
	inArray,
	type RepositoryImport,
	type RepositoryImportId,
	repositories,
	repositoryImports,
	user,
} from '@repo/db'
import type { RepositoryId, RepositorySlug, UserId } from '@repo/domain'

interface UserParams {
	userId: UserId
}

interface CreateImportParams extends UserParams {
	repository: GitHubRepositoryMetadata
	targetSlug: RepositorySlug
}

interface ImportIdParams extends UserParams {
	importId: RepositoryImportId
}

interface SourceParams extends UserParams {
	githubId: string
}

interface TargetSlugParams extends UserParams {
	targetSlug: RepositorySlug
}

interface MarkRunningParams {
	importId: RepositoryImportId
}

interface MarkSucceededParams extends MarkRunningParams {
	repositoryId: RepositoryId
}

interface MarkFailedParams extends MarkRunningParams {
	failureReason: string
}

export interface GitHubAccountCredentials {
	accessToken: string | null
	scope: string | null
	accessTokenExpiresAt: Date | null
}

@Injectable()
export class GitHubImportRepository {
	constructor(private readonly db: Database) {}

	async findGitHubAccount({
		userId,
	}: UserParams): Promise<GitHubAccountCredentials | undefined> {
		return await this.db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
			columns: {
				accessToken: true,
				scope: true,
				accessTokenExpiresAt: true,
			},
		})
	}

	async listImports({ userId }: UserParams): Promise<RepositoryImport[]> {
		return await this.db.query.repositoryImports.findMany({
			where: eq(repositoryImports.ownerUserId, userId),
			orderBy: [desc(repositoryImports.createdAt)],
		})
	}

	async findImport({
		importId,
		userId,
	}: ImportIdParams): Promise<RepositoryImport | undefined> {
		return await this.db.query.repositoryImports.findFirst({
			where: and(
				eq(repositoryImports.id, importId),
				eq(repositoryImports.ownerUserId, userId)
			),
		})
	}

	async findOwnerUsername({ userId }: UserParams): Promise<string | undefined> {
		const row = await this.db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { username: true },
		})

		return row?.username ?? undefined
	}

	async hasActiveSource({ githubId, userId }: SourceParams): Promise<boolean> {
		const row = await this.db.query.repositoryImports.findFirst({
			where: and(
				eq(repositoryImports.ownerUserId, userId),
				eq(repositoryImports.sourceGithubId, BigInt(githubId)),
				inArray(repositoryImports.status, ['pending', 'running', 'succeeded'])
			),
			columns: { id: true },
		})

		return Boolean(row)
	}

	async hasActiveTargetSlug({
		targetSlug,
		userId,
	}: TargetSlugParams): Promise<boolean> {
		const row = await this.db.query.repositoryImports.findFirst({
			where: and(
				eq(repositoryImports.ownerUserId, userId),
				eq(repositoryImports.targetSlug, targetSlug),
				inArray(repositoryImports.status, ['pending', 'running', 'succeeded'])
			),
			columns: { id: true },
		})

		return Boolean(row)
	}

	async hasRepositoryTargetSlug({
		targetSlug,
		userId,
	}: TargetSlugParams): Promise<boolean> {
		const row = await this.db.query.repositories.findFirst({
			where: and(
				eq(repositories.ownerUserId, userId),
				eq(repositories.slug, targetSlug)
			),
			columns: { id: true },
		})

		return Boolean(row)
	}

	async createImport({
		repository,
		targetSlug,
		userId,
	}: CreateImportParams): Promise<RepositoryImport> {
		const [repositoryImport] = await this.db
			.insert(repositoryImports)
			.values({
				ownerUserId: userId,
				provider: 'github',
				targetName: repository.name,
				targetSlug,
				sourceGithubId: BigInt(repository.githubId),
				sourceOwnerLogin: repository.ownerLogin,
				sourceName: repository.name,
				sourceFullName: repository.fullName,
				sourceVisibility: repository.visibility,
				sourceDefaultBranch: repository.defaultBranch,
				sourceGithubUrl: repository.githubUrl,
			})
			.returning()

		if (!repositoryImport) throw new Error('Failed to create repository import')

		return repositoryImport
	}

	async markRunning({
		importId,
	}: MarkRunningParams): Promise<RepositoryImport | undefined> {
		const [repositoryImport] = await this.db
			.update(repositoryImports)
			.set({
				status: 'running',
				startedAt: new Date(),
				failureReason: null,
			})
			.where(
				and(
					eq(repositoryImports.id, importId),
					inArray(repositoryImports.status, ['pending', 'running'])
				)
			)
			.returning()

		return repositoryImport
	}

	async markSucceeded({
		importId,
		repositoryId,
	}: MarkSucceededParams): Promise<RepositoryImport | undefined> {
		const [repositoryImport] = await this.db
			.update(repositoryImports)
			.set({
				status: 'succeeded',
				repositoryId,
				completedAt: new Date(),
				failureReason: null,
			})
			.where(
				and(
					eq(repositoryImports.id, importId),
					inArray(repositoryImports.status, ['pending', 'running'])
				)
			)
			.returning()

		return repositoryImport
	}

	async markFailed({
		failureReason,
		importId,
	}: MarkFailedParams): Promise<RepositoryImport | undefined> {
		const [repositoryImport] = await this.db
			.update(repositoryImports)
			.set({
				status: 'failed',
				failureReason,
				completedAt: new Date(),
			})
			.where(
				and(
					eq(repositoryImports.id, importId),
					inArray(repositoryImports.status, ['pending', 'running'])
				)
			)
			.returning()

		return repositoryImport
	}
}
