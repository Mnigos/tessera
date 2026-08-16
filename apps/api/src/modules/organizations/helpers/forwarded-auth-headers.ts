import type { AppRequest } from '~/shared/types/app-request'

// Body headers describe the inbound request, not the one sent to Better Auth.
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
