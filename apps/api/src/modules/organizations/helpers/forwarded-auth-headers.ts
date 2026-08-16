import type { AppRequest } from '~/shared/types/app-request'

/**
 * Headers that describe the request body Tessera received, not the one it is
 * about to send. Better Auth is called in-process with a body of our own
 * making, so carrying these across would describe the wrong payload.
 */
const BODY_HEADERS = new Set(['content-length', 'content-type'])

/**
 * The caller's headers, for Better Auth calls that must judge the caller.
 *
 * Better Auth resolves the session from the cookie the browser sent, so
 * forwarding the request's headers is what makes it evaluate the person who
 * asked rather than a user id this process vouched for. The adapter has already
 * lowercased them.
 */
export function toForwardedAuthHeaders(
	request: AppRequest
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(request.headers ?? {}).filter(
			([name]) => !BODY_HEADERS.has(name)
		)
	)
}
