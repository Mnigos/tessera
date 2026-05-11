import swc from 'unplugin-swc'
import { configDefaults, defineConfig } from 'vitest/config'

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
		exclude: [...configDefaults.exclude, 'tests/integration/**/*.spec.ts'],
		env: {
			DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
			AUTH_SECRET: 'test-auth-secret',
			GITHUB_CLIENT_ID: 'test-github-client-id',
			GITHUB_CLIENT_SECRET: 'test-github-client-secret',
			REDIS_URL: 'redis://localhost:6379',
		},
		coverage: {
			include: [
				'src/modules/**/application/**/*.ts',
				'src/modules/**/domain/**/*.ts',
				'src/modules/**/infrastructure/**/*.ts',
			],
			exclude: ['src/**/*.spec.ts'],
			thresholds: {
				branches: 100,
				functions: 100,
				lines: 100,
				statements: 100,
			},
		},
	},
})
