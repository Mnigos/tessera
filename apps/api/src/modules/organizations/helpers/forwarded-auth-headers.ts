import type { AppRequest } from '~/shared/types/app-request'

// Describe the body Tessera received, not the in-process body it is about to
// send to Better Auth.
const BODY_HEADERS = new Set(['content-length', 'content-type'])

export function toForwardedAuthHeaders(
	request: AppRequest
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(request.headers ?? {}).filter(
			([name]) => !BODY_HEADERS.has(name)
		)
	)
}
