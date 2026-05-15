import { defineConfig } from 'vitest/config'

const suiteRoot = new URL('./', import.meta.url)
export default defineConfig({
	resolve: {
		preserveSymlinks: true,
		alias: [
			{
				find: /^zod$/,
				replacement: new URL('helpers/zod.ts', suiteRoot).pathname,
			},
		],
	},
	ssr: {
		noExternal: ['@repo/contracts', 'zod'],
	},
	test: {
		server: {
			deps: {
				inline: ['@repo/contracts', 'zod'],
			},
		},
		globals: true,
		root: suiteRoot.pathname,
		fileParallelism: false,
		maxWorkers: 1,
		include: ['**/*.e2e.spec.ts'],
		testTimeout: 120_000,
		hookTimeout: 120_000,
		env: {
			DATABASE_URL:
				process.env.DATABASE_URL ??
				'postgresql://test:test@localhost:5432/tessera_test',
			DB_POOL_MAX: '5',
			REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
			AUTH_SECRET: 'test-auth-secret',
			INTERNAL_API_TOKEN: 'test-internal-token',
			GITHUB_CLIENT_ID: 'test-github-client-id',
			GITHUB_CLIENT_SECRET: 'test-github-client-secret',
			TESSERA_SKIP_ENV_FILE: 'true',
		},
	},
})
