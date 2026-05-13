import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { GIT_ACCESS_TOKEN_CONFIG_ID } from '@repo/auth'
import { and, apikey, asc, eq } from '@repo/db'
import type { ApiKeyId, UserId } from '@repo/domain'

interface UserParams {
	userId: UserId
}

interface TokenParams extends UserParams {
	tokenId: ApiKeyId
}

@Injectable()
export class GitAccessTokensRepository {
	constructor(private readonly db: Database) {}

	async list({ userId }: UserParams) {
		return await this.db.query.apikey.findMany({
			where: and(
				eq(apikey.referenceId, userId),
				eq(apikey.configId, GIT_ACCESS_TOKEN_CONFIG_ID),
				eq(apikey.enabled, true)
			),
			orderBy: [asc(apikey.createdAt)],
		})
	}

	async findOwned({ tokenId, userId }: TokenParams) {
		return await this.db.query.apikey.findFirst({
			where: and(
				eq(apikey.id, tokenId),
				eq(apikey.referenceId, userId),
				eq(apikey.configId, GIT_ACCESS_TOKEN_CONFIG_ID)
			),
		})
	}
}
