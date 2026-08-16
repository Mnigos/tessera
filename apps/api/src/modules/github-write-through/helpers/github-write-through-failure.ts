import {
	GitHubRateLimitedError,
	GitHubReconnectRequiredError,
	GitHubUnavailableError,
	GitHubWriteForbiddenError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_METHOD_NOT_ALLOWED = 405
const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422
const HTTP_TOO_MANY_REQUESTS = 429

/** Which call failed: a 422 means different things for a merge and for a comment. */
export type GitHubWriteAction =
	| 'comment'
	| 'merge'
	| 'pull_request'
	| 'review'
	| 'reviewers'
	| 'thread'

/** GraphQL answers 200 with a typed error rather than a status of its own. */
const GRAPHQL_ERROR_STATUSES: Record<string, number> = {
	FORBIDDEN: HTTP_FORBIDDEN,
	NOT_FOUND: HTTP_NOT_FOUND,
	UNAUTHORIZED: HTTP_UNAUTHORIZED,
	RATE_LIMITED: HTTP_TOO_MANY_REQUESTS,
	UNPROCESSABLE: HTTP_UNPROCESSABLE,
}

/** A 403 GitHub blames on the credential rather than on the permission. */
const CREDENTIAL_PATTERN =
	/token|sso|single[- ]sign[- ]on|saml|scope|credential|expired/i
const SELF_APPROVAL_PATTERN = /own pull request/i
const ANCHOR_PATTERN = /line|side|diff|position|commit_id|path/i
// GitHub allows one unsubmitted review per reviewer, and names it when refusing.
const PENDING_REVIEW_PATTERN = /pending review/i
const STALE_COMMIT_PATTERN = /commit/i

export function toGitHubWriteError(
	error: unknown,
	action: GitHubWriteAction
): Error {
	const status = toStatus(error)
	const detail = toDetail(error)

	if (status === HTTP_UNAUTHORIZED)
		return new GitHubReconnectRequiredError({ action, reason: 'unauthorized' })

	if (isRateLimited(status, error))
		return new GitHubRateLimitedError({ action })

	if (status === HTTP_FORBIDDEN)
		return CREDENTIAL_PATTERN.test(detail)
			? new GitHubReconnectRequiredError({ action, reason: 'credential' })
			: new GitHubWriteForbiddenError({ action, status })

	if (status === HTTP_NOT_FOUND)
		return new GitHubWriteForbiddenError({ action, status })

	if (action === 'merge' && status === HTTP_METHOD_NOT_ALLOWED)
		return new GitHubWriteRejectedError('unmergeable', { action, status })

	if (action === 'merge' && status === HTTP_CONFLICT)
		return new GitHubWriteRejectedError('stale_head', { action, status })

	if (status === HTTP_UNPROCESSABLE)
		return toUnprocessableError(action, detail, status)

	return new GitHubUnavailableError({ action, status }, { cause: error })
}

function toUnprocessableError(
	action: GitHubWriteAction,
	detail: string,
	status: number
): Error {
	if (SELF_APPROVAL_PATTERN.test(detail))
		return new GitHubWriteRejectedError('self_approval', { action, status })

	if (action === 'merge')
		return new GitHubWriteRejectedError('unmergeable', { action, status })

	if (action === 'review' && PENDING_REVIEW_PATTERN.test(detail))
		return new GitHubWriteRejectedError('github_pending_review_exists', {
			action,
			status,
		})

	if (action === 'review' && STALE_COMMIT_PATTERN.test(detail))
		return new GitHubWriteRejectedError('stale_head', { action, status })

	if (action === 'comment' || ANCHOR_PATTERN.test(detail))
		return new GitHubWriteRejectedError('invalid_anchor', { action, status })

	return new GitHubWriteForbiddenError({ action, status })
}

function isRateLimited(status: number | undefined, error: unknown): boolean {
	if (status === HTTP_TOO_MANY_REQUESTS) return true
	if (status !== HTTP_FORBIDDEN) return false

	const headers = toHeaders(error)

	return (
		readHeader(headers, 'retry-after') !== undefined ||
		readHeader(headers, 'x-ratelimit-remaining') === '0'
	)
}

function toStatus(error: unknown): number | undefined {
	if (!error || typeof error !== 'object') return undefined

	if ('status' in error && typeof error.status === 'number') return error.status

	const [first] =
		'errors' in error && Array.isArray(error.errors)
			? (error.errors as { type?: unknown }[])
			: []

	return typeof first?.type === 'string'
		? GRAPHQL_ERROR_STATUSES[first.type]
		: undefined
}

function toHeaders(error: unknown): Record<string, unknown> {
	if (!error || typeof error !== 'object') return {}

	const response = 'response' in error ? error.response : undefined
	const headers =
		response && typeof response === 'object' && 'headers' in response
			? response.headers
			: undefined

	return headers && typeof headers === 'object'
		? (headers as Record<string, unknown>)
		: {}
}

function readHeader(
	headers: Record<string, unknown>,
	name: string
): string | undefined {
	const value = headers[name]

	return typeof value === 'string' && value.length > 0
		? value
		: typeof value === 'number'
			? String(value)
			: undefined
}

/** Read only to pick a Tessera message; never returned to a client. */
function toDetail(error: unknown): string {
	if (!(error instanceof Error)) return ''

	const response = 'response' in error ? error.response : undefined
	const data =
		response && typeof response === 'object' && 'data' in response
			? response.data
			: undefined

	return `${error.message} ${data ? JSON.stringify(data) : ''}`
}
