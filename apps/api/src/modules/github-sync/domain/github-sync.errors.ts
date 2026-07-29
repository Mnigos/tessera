import { ExternalServiceError, ServiceUnavailableError } from '~/shared/errors'

export class GitHubAppConfigurationError extends ServiceUnavailableError {
	constructor(context?: Record<string, unknown>) {
		super('github app', context, 'GitHub App synchronization is not configured')
	}
}

export class GitHubSyncExternalServiceError extends ExternalServiceError {
	constructor(
		context?: Record<string, unknown>,
		options?: { cause?: unknown }
	) {
		super('github', context, 'GitHub synchronization failed', options)
	}
}
