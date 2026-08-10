import type { GitHubSyncFailureClass } from '@repo/db'
import { ZodError } from 'zod'
import { DomainError } from '~/shared/errors'
import type { GitHubChecksRequestScope } from '../infrastructure/github-sync.client.types'

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500
/** Enough to name where a payload disagreed without carrying the payload. */
const MAX_REPORTED_ISSUE_PATHS = 5

/**
 * Which request failed, which is what tells two identical statuses apart. A 404
 * from a commit's own listing means the commit is gone; a 404 from the
 * repository means GitHub may be hiding a repository this installation no
 * longer has access to.
 */
export type GitHubSyncRequestScope =
	| 'repository'
	| 'conversation'
	| 'installation_token'
	| GitHubChecksRequestScope

/**
 * A failure reduced to what Tessera is willing to keep: a class that decides
 * what happens next, a stable code, and identifiers. Provider headers, bodies,
 * messages, and tokens never reach this shape, so anything holding one can be
 * persisted or logged without further redaction.
 */
export interface GitHubSyncFailure {
	failureClass: GitHubSyncFailureClass
	failureCode: string
	scope?: GitHubSyncRequestScope
	statusCode?: number
	requestId?: string
	retryAt?: Date
	rateLimitRemaining?: number
	/** Where a provider payload disagreed with the schema, never what it held. */
	issuePaths?: string[]
}

/**
 * The codes a failure is reduced to. `reconciliation_failed` stays the code for
 * anything unclassified, which is what the source row already recorded for
 * every failure before the taxonomy existed.
 */
export const GITHUB_SYNC_FAILURE_CODES = {
	rateLimited: 'rate_limited',
	authenticationFailed: 'authentication_failed',
	authorizationFailed: 'authorization_failed',
	repositoryUnavailable: 'repository_unavailable',
	notFound: 'resource_not_found',
	schemaMismatch: 'provider_schema_mismatch',
	requestRejected: 'provider_rejected_request',
	upstreamUnavailable: 'upstream_unavailable',
	unknown: 'reconciliation_failed',
} as const

/**
 * The codes a failure is allowed to carry. A code read back off an error is a
 * string somebody else wrote, and it ends up in the database, in logs, and on
 * the failed job — so one that is not in this set is reported as a generic
 * failure rather than passed along.
 */
const ALLOWED_FAILURE_CODES: ReadonlySet<string> = new Set(
	Object.values(GITHUB_SYNC_FAILURE_CODES)
)

/**
 * What the source row tells a reader, per class. The reason is the only failure
 * text Tessera ever shows or stores, so each is written for the person who has
 * to act on it rather than for whoever debugs it.
 */
const GITHUB_SYNC_FAILURE_REASONS: Record<GitHubSyncFailureClass, string> = {
	transport: 'GitHub could not be reached. Tessera will retry automatically.',
	rate_limit:
		'GitHub is rate limiting this installation. Synchronization resumes once the limit resets.',
	authentication:
		'Tessera lost access to this repository on GitHub. Reauthorize the Tessera GitHub App to resume synchronization.',
	validation:
		'GitHub returned data Tessera could not read. Synchronization will retry on the next scheduled run.',
	permanent_not_found:
		'GitHub no longer has part of what this repository was synchronizing.',
	unknown:
		'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.',
}

export function toGitHubSyncFailureReason(
	failureClass: GitHubSyncFailureClass
): string {
	return GITHUB_SYNC_FAILURE_REASONS[failureClass]
}

/**
 * Reduces whatever a GitHub request threw to the safe shape, using only the
 * status and the handful of headers that describe retryability.
 *
 * A 403 is read as a rate limit only from headers: the distinguishing detail
 * GitHub puts in the response body is exactly the kind of foreign text that
 * must not travel, and both the primary and the secondary limit announce
 * themselves in headers anyway.
 */
export function classifyGitHubSyncFailure(
	error: unknown,
	scope?: GitHubSyncRequestScope
): GitHubSyncFailure {
	if (error instanceof ZodError)
		return {
			failureClass: 'validation',
			failureCode: GITHUB_SYNC_FAILURE_CODES.schemaMismatch,
			scope,
			issuePaths: toIssuePaths(error),
		}

	const headers = toResponseHeaders(error)
	const statusCode = toHttpStatusCode(error)

	return classifyStatusCode(statusCode, {
		rateLimitRemaining: toRateLimitRemaining(headers),
		rateLimited: isRateLimited(statusCode, headers),
		requestId: readHeader(headers, 'x-github-request-id'),
		retryAt: toRateLimitRetryAt(headers),
		scope,
	})
}

interface GitHubSyncFailureSignals {
	rateLimited: boolean
	rateLimitRemaining?: number
	requestId?: string
	retryAt?: Date
	scope?: GitHubSyncRequestScope
}

function classifyStatusCode(
	statusCode: number | undefined,
	{
		rateLimited,
		rateLimitRemaining,
		requestId,
		retryAt,
		scope,
	}: GitHubSyncFailureSignals
): GitHubSyncFailure {
	const base = { scope, statusCode, requestId, rateLimitRemaining }

	if (statusCode === undefined)
		return {
			...base,
			failureClass: 'transport',
			failureCode: GITHUB_SYNC_FAILURE_CODES.upstreamUnavailable,
		}

	if (rateLimited)
		return {
			...base,
			failureClass: 'rate_limit',
			failureCode: GITHUB_SYNC_FAILURE_CODES.rateLimited,
			retryAt,
		}

	if (statusCode === HTTP_UNAUTHORIZED)
		return {
			...base,
			failureClass: 'authentication',
			failureCode: GITHUB_SYNC_FAILURE_CODES.authenticationFailed,
		}

	if (statusCode === HTTP_FORBIDDEN)
		return {
			...base,
			failureClass: 'authentication',
			failureCode: GITHUB_SYNC_FAILURE_CODES.authorizationFailed,
		}

	// GitHub answers a repository the installation may not see with a 404 rather
	// than a 403, so a repository that vanished is read as lost access, as is an
	// installation that can no longer be authenticated. A commit or one of its
	// listings really is gone, and settling it is the only way its deliveries
	// stop blocking later ones.
	if (statusCode === HTTP_NOT_FOUND)
		return scope === 'repository' || scope === 'installation_token'
			? {
					...base,
					failureClass: 'authentication',
					failureCode: GITHUB_SYNC_FAILURE_CODES.repositoryUnavailable,
				}
			: {
					...base,
					failureClass: 'permanent_not_found',
					failureCode: GITHUB_SYNC_FAILURE_CODES.notFound,
				}

	if (statusCode === HTTP_REQUEST_TIMEOUT || statusCode >= HTTP_SERVER_ERROR)
		return {
			...base,
			failureClass: 'transport',
			failureCode: GITHUB_SYNC_FAILURE_CODES.upstreamUnavailable,
		}

	return {
		...base,
		failureClass: 'validation',
		failureCode: GITHUB_SYNC_FAILURE_CODES.requestRejected,
	}
}

/**
 * The classification a client already made, as carried on the error it threw.
 * An error that never reached GitHub — git storage, configuration, a bug — has
 * none and stays `unknown`, which retries exactly as every failure did before
 * the taxonomy existed.
 */
export function readGitHubSyncFailure(error: unknown): GitHubSyncFailure {
	if (!(error instanceof DomainError && error.context)) return unknownFailure()

	const { context } = error
	const scope = isRequestScope(context.scope) ? context.scope : undefined
	const statusCode =
		typeof context.statusCode === 'number' ? context.statusCode : undefined

	if (!isFailureClass(context.failureClass))
		// A status without a class is a request that failed before the taxonomy
		// reached it, so it is classified here instead of being written off.
		return statusCode === undefined
			? unknownFailure()
			: classifyStatusCode(statusCode, { rateLimited: false, scope })

	return {
		failureClass: context.failureClass,
		failureCode: toAllowedFailureCode(context.failureCode),
		scope,
		statusCode,
		requestId:
			typeof context.requestId === 'string' ? context.requestId : undefined,
		retryAt: context.retryAt instanceof Date ? context.retryAt : undefined,
		rateLimitRemaining:
			typeof context.rateLimitRemaining === 'number'
				? context.rateLimitRemaining
				: undefined,
	}
}

function toAllowedFailureCode(failureCode: unknown): string {
	return typeof failureCode === 'string' &&
		ALLOWED_FAILURE_CODES.has(failureCode)
		? failureCode
		: GITHUB_SYNC_FAILURE_CODES.unknown
}

function unknownFailure(): GitHubSyncFailure {
	return {
		failureClass: 'unknown',
		failureCode: GITHUB_SYNC_FAILURE_CODES.unknown,
	}
}

function isRequestScope(value: unknown): value is GitHubSyncRequestScope {
	return (
		value === 'repository' ||
		value === 'conversation' ||
		value === 'installation_token' ||
		value === 'ref' ||
		value === 'suite'
	)
}

function isFailureClass(value: unknown): value is GitHubSyncFailureClass {
	return (
		value === 'transport' ||
		value === 'rate_limit' ||
		value === 'authentication' ||
		value === 'validation' ||
		value === 'permanent_not_found' ||
		value === 'unknown'
	)
}

function toIssuePaths({ issues }: ZodError): string[] {
	const paths = new Set<string>()

	for (const issue of issues) {
		if (paths.size >= MAX_REPORTED_ISSUE_PATHS) break

		paths.add(issue.path.join('.') || '(root)')
	}

	return [...paths]
}

/** Octokit reports the HTTP status on the error it throws; anything else has none. */
function toHttpStatusCode(error: unknown): number | undefined {
	if (!(error && typeof error === 'object' && 'status' in error))
		return undefined

	return typeof error.status === 'number' ? error.status : undefined
}

function toResponseHeaders(error: unknown): Record<string, unknown> {
	if (!(error && typeof error === 'object' && 'response' in error)) return {}

	const { response } = error

	if (!(response && typeof response === 'object' && 'headers' in response))
		return {}

	const { headers } = response

	return headers && typeof headers === 'object'
		? (headers as Record<string, unknown>)
		: {}
}

function readHeader(
	headers: Record<string, unknown>,
	name: string
): string | undefined {
	const value = headers[name]

	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toRateLimitRemaining(
	headers: Record<string, unknown>
): number | undefined {
	const remaining = Number(readHeader(headers, 'x-ratelimit-remaining'))

	return Number.isInteger(remaining) && remaining >= 0 ? remaining : undefined
}

function isRateLimited(
	statusCode: number | undefined,
	headers: Record<string, unknown>
): boolean {
	if (statusCode === HTTP_TOO_MANY_REQUESTS) return true
	if (statusCode !== HTTP_FORBIDDEN) return false

	// A secondary limit answers with `retry-after` and leaves the budget alone;
	// a primary limit exhausts the budget. Either one is a wait, not a refusal.
	return (
		readHeader(headers, 'retry-after') !== undefined ||
		toRateLimitRemaining(headers) === 0
	)
}

function toRateLimitRetryAt(
	headers: Record<string, unknown>
): Date | undefined {
	const retryAfterSeconds = Number(readHeader(headers, 'retry-after'))

	if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0)
		return new Date(Date.now() + retryAfterSeconds * 1000)

	const resetSeconds = Number(readHeader(headers, 'x-ratelimit-reset'))

	if (Number.isFinite(resetSeconds) && resetSeconds > 0)
		return new Date(resetSeconds * 1000)

	return undefined
}
