import { isHttpCloneUrl, isSshCloneRemote } from '@repo/contracts'
import { z } from 'zod'

/**
 * Where clones of a Tessera-authoritative repository point. The API derives
 * every repository's clone URLs because it is the only side that knows whether
 * GitHub still owns the repository, and these must match the web app's
 * `VITE_PUBLIC_GIT_*_BASE_URL` values — nothing here can check that, so the two
 * are documented together in `docs/railway-deployments.md`.
 *
 * Left without defaults on purpose. A deployment that silently fell back to
 * localhost would serve clone URLs nobody outside the container can reach, and
 * would do it without failing, so the fallback is applied only after the
 * environment has been established as local.
 */
const gitHttpBaseUrlSchema = z
	.url()
	.refine(isHttpCloneUrl, { message: 'must use http or https' })

const gitSshBaseUrlSchema = z
	.url()
	.refine(isSshCloneRemote, { message: 'must be an ssh:// URL' })

const LOCAL_GIT_HTTP_BASE_URL = 'http://localhost:4001'
const LOCAL_GIT_SSH_BASE_URL = 'ssh://git@localhost:2222'

const REQUIRED_IN_PRODUCTION = [
	'GIT_HTTP_BASE_URL',
	'GIT_SSH_BASE_URL',
] as const

const baseEnvSchema = z.object({
	NODE_ENV: z
		.enum(['development', 'test', 'production'])
		.default('development'),
	PORT: z.coerce.number().default(4000),
	DATABASE_URL: z
		.string()
		.default('postgresql://tessera:tessera@localhost:5432/tessera'),
	// At least 2: an organization write holds one connection while Better Auth
	// takes a second one of its own.
	DB_POOL_MAX: z.coerce.number().int().min(2).default(5),
	DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().positive().default(250),
	REDIS_URL: z.string().default('redis://localhost:6379'),
	GIT_SERVICE_URL: z.string().default('localhost:50051'),
	GIT_HTTP_BASE_URL: gitHttpBaseUrlSchema.optional(),
	GIT_SSH_BASE_URL: gitSshBaseUrlSchema.optional(),
	INTERNAL_API_TOKEN: z.string().min(1),
	CACHE_REDIS_DB: z.coerce.number().int().min(0).default(1),
	BULL_BOARD_PATH: z.string().default('/admin/queues'),
	BULL_BOARD_USERNAME: z.string().optional(),
	BULL_BOARD_PASSWORD: z.string().optional(),
	GITHUB_MIRROR_SYNC_CRONTIME: z.string().default('*/30 * * * *'),
	GITHUB_MIRROR_SYNC_BATCH_SIZE: z.coerce.number().int().positive().default(25),
	GITHUB_MIRROR_SYNC_INTERVAL_MINUTES: z.coerce
		.number()
		.int()
		.positive()
		.default(60),
	APP_URL: z.string().default('http://localhost:3000'),
	API_URL: z.string().default('http://localhost:4000'),
	API_GRPC_URL: z.string().default('localhost:50053'),
	AUTH_SECRET: z.string().default('development-auth-secret'),
	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
	GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
	GITHUB_APP_INSTALL_URL: z.url().optional(),
	GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
	GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
	GITHUB_SYNC_LEASE_MINUTES: z.coerce.number().int().positive().default(15),
	/**
	 * How often the merge queue re-derives its work from PostgreSQL. Redis only
	 * wakes the worker, so this is what recovers a wakeup that was never
	 * delivered, and it runs often because a queue nobody woke is a queue that
	 * silently stopped merging.
	 */
	MERGE_QUEUE_RECONCILER_CRONTIME: z.string().default('*/1 * * * *'),
	MERGE_QUEUE_RECONCILER_BATCH_SIZE: z.coerce
		.number()
		.int()
		.positive()
		.default(25),
	SENTRY_DSN: z.string().optional(),
	SENTRY_ENVIRONMENT: z.string().default('development'),
	SENTRY_RELEASE: z.string().optional(),
	RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
	SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
})

export const envSchema = baseEnvSchema
	.superRefine((environment, context) => {
		if (environment.NODE_ENV !== 'production') return

		for (const key of REQUIRED_IN_PRODUCTION)
			if (!environment[key])
				context.addIssue({
					code: 'custom',
					path: [key],
					message: `${key} is required in production; it must match the web app's VITE_PUBLIC_${key} value`,
				})
	})
	// Applied only once production has been ruled out, so a local checkout keeps
	// working with no configuration and a deployment cannot inherit localhost.
	.transform(environment => ({
		...environment,
		GIT_HTTP_BASE_URL: environment.GIT_HTTP_BASE_URL ?? LOCAL_GIT_HTTP_BASE_URL,
		GIT_SSH_BASE_URL: environment.GIT_SSH_BASE_URL ?? LOCAL_GIT_SSH_BASE_URL,
	}))

export type Env = z.infer<typeof envSchema>

export const parseEnv = (environment: unknown) => envSchema.parse(environment)
