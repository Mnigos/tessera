import {
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
	type GitHubWriteRejectionReason,
} from '@repo/contracts'
import {
	ConflictError,
	ExternalServiceError,
	ForbiddenError,
	TooManyRequestsError,
	UnauthorizedError,
} from '~/shared/errors'

export class GitHubReconnectRequiredError extends UnauthorizedError {
	constructor(context?: Record<string, unknown>) {
		super('github write-through', context, GITHUB_RECONNECT_REQUIRED_MESSAGE)
	}
}

export class GitHubWriteForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('github write-through', context, GITHUB_WRITE_FORBIDDEN_MESSAGE)
	}
}

export class GitHubWriteRejectedError extends ConflictError {
	constructor(
		readonly reason: GitHubWriteRejectionReason,
		context?: Record<string, unknown>
	) {
		super(
			'github write-through',
			{ ...context, reason },
			GITHUB_WRITE_REJECTED_MESSAGES[reason]
		)
	}
}

export class GitHubRateLimitedError extends TooManyRequestsError {
	constructor(context?: Record<string, unknown>) {
		super('github write-through', context, GITHUB_RATE_LIMITED_MESSAGE)
	}
}

/** GitHub accepted the write and the local echo did not land. */
export class GitHubSyncDelayedError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super('github write-through', context, GITHUB_SYNC_DELAYED_MESSAGE)
	}
}

/** A 2xx Tessera could not read; never surfaced, because the write already happened. */
export class GitHubResponseUnreadableError extends ExternalServiceError {
	constructor(context?: Record<string, unknown>) {
		super('github', context, GITHUB_UNAVAILABLE_MESSAGE)
	}
}

export class GitHubUnavailableError extends ExternalServiceError {
	constructor(
		context?: Record<string, unknown>,
		options?: { cause?: unknown }
	) {
		super('github', context, GITHUB_UNAVAILABLE_MESSAGE, options)
	}
}
