import { Injectable } from '@nestjs/common'
import type { GitHubImportRepository } from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { GitHubImportAuthenticationError } from '../domain/github-import.errors'
import { GitHubImportRepository as GitHubImportAccountsRepository } from '../infrastructure/github-import.repository'
import { GitHubOctokitClient } from '../infrastructure/github-octokit.client'

@Injectable()
export class GitHubImportService {
	constructor(
		private readonly githubImportRepository: GitHubImportAccountsRepository,
		private readonly githubOctokitClient: GitHubOctokitClient
	) {}

	async listRepositories(userId: UserId): Promise<GitHubImportRepository[]> {
		const account = await this.githubImportRepository.findGitHubAccount({
			userId,
		})

		if (!account?.accessToken)
			throw new GitHubImportAuthenticationError({
				reason: 'missing_github_account_token',
				userId,
			})

		return await this.githubOctokitClient.listRepositories({
			accessToken: account.accessToken,
		})
	}
}
