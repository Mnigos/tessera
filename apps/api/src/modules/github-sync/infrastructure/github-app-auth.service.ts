import { EnvService } from '@config/env'
import { Injectable, Logger } from '@nestjs/common'
import { createAppAuth } from '@octokit/auth-app'
import {
	GitHubAppConfigurationError,
	GitHubSyncExternalServiceError,
} from '../domain/github-sync.errors'
import { classifyGitHubSyncFailure } from '../domain/github-sync-failure'

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

	/**
	 * Forgets a cached token. A token stays valid for an hour, so an installation
	 * whose access was revoked would otherwise keep presenting the same rejected
	 * credential until it expired — including on the retry that follows the
	 * revocation being discovered.
	 */
	evictInstallationToken(externalInstallationId: bigint): void {
		this.cachedTokens.delete(externalInstallationId.toString())
	}

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
			// The stack of a rejected authentication carries whatever the provider
			// library put in it, so only the classification is logged and only the
			// classification travels on the error the caller sees.
			const failure = classifyGitHubSyncFailure(error, 'installation_token')

			this.logger.error(
				`GitHub App authentication for installation ${externalInstallationId} failed as ${failure.failureClass}/${failure.failureCode}`
			)

			// The provider error is not attached as a cause either: it holds the
			// request it just signed, and generic error logging prints causes.
			throw new GitHubSyncExternalServiceError({
				externalInstallationId: externalInstallationId.toString(),
				...failure,
			})
		}
	}
}
