import { parseEnv } from './env.schema'

const BASE_ENVIRONMENT = {
	INTERNAL_API_TOKEN: 'internal-token',
}

const HTTP_BASE_URL_REQUIRED_REGEX =
	/GIT_HTTP_BASE_URL is required in production/
const SSH_BASE_URL_REQUIRED_REGEX = /GIT_SSH_BASE_URL is required in production/

describe('parseEnv', () => {
	test('falls back to local clone base URLs outside production', () => {
		expect(parseEnv(BASE_ENVIRONMENT)).toMatchObject({
			GIT_HTTP_BASE_URL: 'http://localhost:4001',
			GIT_SSH_BASE_URL: 'ssh://git@localhost:2222',
		})
	})

	// A deployment inheriting localhost would serve clone URLs nobody outside the
	// container can reach, and would do it without any failure to notice.
	test('refuses to boot in production without clone base URLs', () => {
		expect(() =>
			parseEnv({ ...BASE_ENVIRONMENT, NODE_ENV: 'production' })
		).toThrow(HTTP_BASE_URL_REQUIRED_REGEX)
	})

	test('names each missing clone base URL separately in production', () => {
		expect(() =>
			parseEnv({
				...BASE_ENVIRONMENT,
				NODE_ENV: 'production',
				GIT_HTTP_BASE_URL: 'https://git.tessera.dev',
			})
		).toThrow(SSH_BASE_URL_REQUIRED_REGEX)
	})

	test('accepts a fully configured production environment', () => {
		expect(
			parseEnv({
				...BASE_ENVIRONMENT,
				NODE_ENV: 'production',
				GIT_HTTP_BASE_URL: 'https://git.tessera.dev',
				GIT_SSH_BASE_URL: 'ssh://git@git.tessera.dev:22',
			})
		).toMatchObject({
			GIT_HTTP_BASE_URL: 'https://git.tessera.dev',
			GIT_SSH_BASE_URL: 'ssh://git@git.tessera.dev:22',
		})
	})

	test.each([
		['GIT_HTTP_BASE_URL', 'ssh://git@git.tessera.dev'],
		['GIT_SSH_BASE_URL', 'https://git.tessera.dev'],
	])('rejects %s with the wrong scheme', (key, value) => {
		expect(() => parseEnv({ ...BASE_ENVIRONMENT, [key]: value })).toThrow()
	})

	test('rejects a clone base URL that is not a web or ssh address at all', () => {
		expect(() =>
			parseEnv({
				...BASE_ENVIRONMENT,
				GIT_HTTP_BASE_URL: 'javascript:alert(1)',
			})
		).toThrow()
	})
})
