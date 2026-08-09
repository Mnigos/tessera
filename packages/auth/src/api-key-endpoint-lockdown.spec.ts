import { apiKeyEndpointLockdown } from './api-key-endpoint-lockdown'

const plugin = apiKeyEndpointLockdown()

async function requestPath(pathname: string) {
	const result = await plugin.onRequest?.(
		new Request(`https://tessera.test${pathname}`),
		// The hook decides from the request alone; the auth context is unused.
		{} as never
	)

	return result && 'response' in result ? result.response : undefined
}

describe('api key endpoint lockdown', () => {
	test('refuses every key-management route the plugin publishes', async () => {
		const blocked = [
			'/api/auth/api-key/create',
			'/api/auth/api-key/delete',
			'/api/auth/api-key/get',
			'/api/auth/api-key/list',
			'/api/auth/api-key/update',
		]

		for (const pathname of blocked) {
			// 404 rather than 403: the routes do not advertise that they exist.
			expect((await requestPath(pathname))?.status).toBe(404)
		}
	})

	test('refuses them under a differently mounted base path and a trailing slash', async () => {
		expect((await requestPath('/auth/api-key/list'))?.status).toBe(404)
		expect((await requestPath('/api/auth/api-key/list/'))?.status).toBe(404)
	})

	test('leaves every other auth route alone', async () => {
		const allowed = [
			'/api/auth/sign-in/social',
			'/api/auth/get-session',
			'/api/auth/sign-out',
			'/api/auth/organization/create',
		]

		for (const pathname of allowed)
			expect(await requestPath(pathname)).toBeUndefined()
	})

	test('does not block a path that merely mentions api-key', async () => {
		expect(await requestPath('/api/auth/api-key/create/extra')).toBeUndefined()
		expect(await requestPath('/api/auth/api-keys')).toBeUndefined()
	})
})
