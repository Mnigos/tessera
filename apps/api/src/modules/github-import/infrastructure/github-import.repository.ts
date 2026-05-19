import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { account, and, eq } from '@repo/db'
import type { UserId } from '@repo/domain'

interface UserParams {
	userId: UserId
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
}
