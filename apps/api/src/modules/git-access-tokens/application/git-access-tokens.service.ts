import { Injectable } from '@nestjs/common'
import {
	type Auth,
	GIT_ACCESS_TOKEN_CONFIG_ID,
	GIT_ACCESS_TOKEN_PREFIX,
	type GitAccessTokenPermission,
	getGitAccessTokenPermission,
} from '@repo/auth'
import type {
	CreateGitAccessTokenInput,
	CreateGitAccessTokenOutput,
	GitAccessToken,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { parseRecord, toGitAccessTokenOutput } from '../domain/git-access-token'
import {
	GitAccessTokenNotFoundError,
	GitAccessTokenPermissionDeniedError,
	InvalidGitAccessTokenError,
} from '../domain/git-access-token.errors'
import {
	hasGitAccessTokenPermission,
	toBetterAuthGitAccessTokenPermissions,
} from '../domain/git-access-token-permissions'
import { GitAccessTokensRepository } from '../infrastructure/git-access-tokens.repository'

type GitAccessTokenId = GitAccessToken['id']

export interface VerifyGitAccessTokenInput {
	rawToken: string | undefined
	requiredPermission: GitAccessTokenPermission
}

export interface GitAccessTokenVerification {
	userId: UserId
	permissions: Record<string, string[]>
}

@Injectable()
export class GitAccessTokensService {
	constructor(
		private readonly betterAuthService: BetterAuthService<Auth>,
		private readonly gitAccessTokensRepository: GitAccessTokensRepository
	) {}

	async create(
		userId: UserId,
		{ expiresIn, name, permissions }: CreateGitAccessTokenInput
	): Promise<CreateGitAccessTokenOutput> {
		const createdToken = await this.betterAuthService.api.createApiKey({
			body: {
				configId: GIT_ACCESS_TOKEN_CONFIG_ID,
				userId,
				name,
				expiresIn,
				prefix: GIT_ACCESS_TOKEN_PREFIX,
				permissions: toBetterAuthGitAccessTokenPermissions(permissions),
			},
		})

		return {
			token: createdToken.key,
			accessToken: {
				id: createdToken.id as GitAccessTokenId,
				name: createdToken.name ?? undefined,
				prefix: createdToken.prefix ?? undefined,
				start: createdToken.start ?? undefined,
				enabled: createdToken.enabled,
				permissions: parseRecord(createdToken.permissions),
				expiresAt: createdToken.expiresAt ?? undefined,
				lastRequest: createdToken.lastRequest ?? undefined,
				createdAt: createdToken.createdAt,
				updatedAt: createdToken.updatedAt,
			},
		}
	}

	async list(userId: UserId): Promise<GitAccessToken[]> {
		const accessTokens = await this.gitAccessTokensRepository.list({ userId })

		return accessTokens.map(toGitAccessTokenOutput)
	}

	async revoke(userId: UserId, tokenId: GitAccessTokenId): Promise<void> {
		const accessToken = await this.gitAccessTokensRepository.findOwned({
			userId,
			tokenId,
		})

		if (!accessToken) throw new GitAccessTokenNotFoundError({ tokenId, userId })

		await this.betterAuthService.api.updateApiKey({
			body: {
				configId: GIT_ACCESS_TOKEN_CONFIG_ID,
				keyId: tokenId,
				userId,
				enabled: false,
			},
		})
	}

	async verify({
		rawToken,
		requiredPermission,
	}: VerifyGitAccessTokenInput): Promise<GitAccessTokenVerification> {
		if (!rawToken)
			throw new InvalidGitAccessTokenError({ reason: 'missing_token' })

		const verifiedToken = await this.betterAuthService.api.verifyApiKey({
			body: {
				configId: GIT_ACCESS_TOKEN_CONFIG_ID,
				key: rawToken,
				permissions: getGitAccessTokenPermission(requiredPermission),
			},
		})

		if (!(verifiedToken.valid && verifiedToken.key))
			throw new InvalidGitAccessTokenError({
				reason: verifiedToken.error?.code ?? 'invalid_token',
			})

		const permissions = parseRecord(verifiedToken.key.permissions) ?? {}
		if (!hasGitAccessTokenPermission(permissions, requiredPermission))
			throw new GitAccessTokenPermissionDeniedError({ requiredPermission })

		return {
			userId: verifiedToken.key.referenceId as UserId,
			permissions,
		}
	}
}
