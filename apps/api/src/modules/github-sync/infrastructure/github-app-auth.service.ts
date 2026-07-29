import { EnvService } from '@config/env'
import { Injectable, Logger } from '@nestjs/common'
import { createAppAuth } from '@octokit/auth-app'
import { GitHubAppConfigurationError } from '../domain/github-sync.errors'

const TOKEN_REFRESH_WINDOW_MS = 5 * 60_000

interface InstallationToken {
	token: string
	expiresAt: Date
}

interface CachedInstallationToken extends InstallationToken {
	installationId: bigint
}

@Injectable()
export class GitHubAppAuthService {
	private readonly logger = new Logger(GitHubAppAuthService.name)
	private readonly cachedTokens = new Map<string, CachedInstallationToken>()

	constructor(private readonly envService: EnvService) {}

	async getInstallationToken(
		externalInstallationId: bigint
	): Promise<InstallationToken> {
		const cacheKey = externalInstallationId.toString()
		const cachedToken = this.cachedTokens.get(cacheKey)

		if (
			cachedToken &&
			cachedToken.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_WINDOW_MS
		)
			return cachedToken

		const appId = this.envService.get('GITHUB_APP_ID')
		const privateKey = this.envService.get('GITHUB_APP_PRIVATE_KEY')

		if (!(appId && privateKey))
			throw new GitHubAppConfigurationError({
				missingAppId: !appId,
				missingPrivateKey: !privateKey,
			})

		const auth = createAppAuth({
			appId,
			privateKey: privateKey.replaceAll('\\n', '\n'),
		})
		const authentication = await this.authenticateInstallation({
			auth,
			externalInstallationId,
		})
		const token = {
			installationId: externalInstallationId,
			token: authentication.token,
			expiresAt: new Date(authentication.expiresAt),
		}

		this.cachedTokens.set(cacheKey, token)

		return token
	}

	private async authenticateInstallation({
		auth,
		externalInstallationId,
	}: {
		auth: ReturnType<typeof createAppAuth>
		externalInstallationId: bigint
	}) {
		try {
			return await auth({
				type: 'installation',
				installationId: Number(externalInstallationId),
			})
		} catch (error) {
			this.logger.error(
				`GitHub App authentication failed for installation ${externalInstallationId}`,
				error instanceof Error ? error.stack : undefined
			)
			throw error
		}
	}
}
