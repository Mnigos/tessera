import { CORS_ALLOW_HEADERS, createCorsOptions } from './cors.options'

describe('createCorsOptions', () => {
	test('enables credentialed CORS scoped to the configured origin', () => {
		expect(createCorsOptions('https://app.tessera.dev')).toEqual({
			origin: 'https://app.tessera.dev',
			credentials: true,
			allowHeaders: ['Accept', 'Authorization', 'Content-Type'],
		})
	})

	test('pins a non-empty allow-headers list so Hono never echoes the request headers', () => {
		const { allowHeaders } = createCorsOptions('https://app.tessera.dev')

		expect(allowHeaders).toEqual(CORS_ALLOW_HEADERS)
		expect(allowHeaders?.length).toBeGreaterThan(0)
	})

	test('covers the headers the web client actually sends', () => {
		const { allowHeaders } = createCorsOptions('https://app.tessera.dev')

		expect(allowHeaders).toContain('Content-Type')
		expect(allowHeaders).toContain('Accept')
	})
})
