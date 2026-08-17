import { authClient } from '@/lib/auth/client'

// `repo` is the scope a write-through needs; both destinations are this page so
// a refused link comes back here instead of the API's own error page.
export async function reconnectGitHub() {
	const { error } = await authClient.linkSocial({
		provider: 'github',
		scopes: ['repo'],
		callbackURL: window.location.href,
		errorCallbackURL: window.location.href,
	})

	return error
}
