import { env } from '@/env'

export function getApiUrl() {
	if (typeof window === 'undefined') return env.API_URL

	return window.location.origin
}
