import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	oxc: false,
	plugins: [
		swc.vite({
			module: { type: 'es6' },
		}),
	],
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		globals: true,
		root: './',
		pool: 'forks',
		fileParallelism: false,
		maxWorkers: 1,
		include: ['tests/integration/**/*.integration.spec.ts'],
		env: {
			DATABASE_URL:
				process.env.DATABASE_URL ??
				'postgresql://test:test@localhost:5432/tessera_test',
			AUTH_SECRET: 'test-auth-secret',
			GITHUB_CLIENT_ID: 'test-github-client-id',
			GITHUB_CLIENT_SECRET: 'test-github-client-secret',
			REDIS_URL: 'redis://localhost:6379',
			INTERNAL_API_TOKEN: 'test-internal-token',
		},
	},
})
