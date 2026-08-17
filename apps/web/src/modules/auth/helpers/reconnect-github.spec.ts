import { authClient } from '@/lib/auth/client'
import { reconnectGitHub } from './reconnect-github'

vi.mock('@/lib/auth/client', () => ({
	authClient: { linkSocial: vi.fn() },
}))

const linkSocialMock = vi.mocked(authClient.linkSocial)

describe(reconnectGitHub.name, () => {
	test('links GitHub with repository access and returns OAuth failures', async () => {
		const error = {
			code: 'oauth_failed',
			message: 'OAuth failed',
			status: 401,
			statusText: 'Unauthorized',
		}
		linkSocialMock.mockResolvedValue({ data: null, error } as never)

		expect(await reconnectGitHub()).toEqual(error)
		expect(linkSocialMock).toHaveBeenCalledWith({
			provider: 'github',
			scopes: ['repo'],
			callbackURL: window.location.href,
			errorCallbackURL: window.location.href,
		})
	})
})
