import { z } from 'zod'

export const envSchema = z.object({
	PORT: z.coerce.number().default(4000),
	DATABASE_URL: z
		.string()
		.default('postgresql://tessera:tessera@localhost:5432/tessera'),
	DB_POOL_MAX: z.coerce.number().int().positive().default(5),
	DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().positive().default(250),
	REDIS_URL: z.string().default('redis://localhost:6379'),
	GIT_SERVICE_URL: z.string().default('localhost:50051'),
	/**
	 * Where clones of a Tessera-authoritative repository point. The API derives
	 * the pair because it is the only side that knows whether GitHub still owns
	 * the repository, and these must match the web app's
	 * `VITE_PUBLIC_GIT_*_BASE_URL` values — nothing here can check that, so the
	 * two are documented together in `docs/railway-deployments.md`.
	 *
	 * Validated as URLs for the same reason the web side is: a scheme-less value
	 * would boot fine and then fail contract validation on every repository read.
	 */
	GIT_HTTP_BASE_URL: z.url().default('http://localhost:4001'),
	GIT_SSH_BASE_URL: z.url().default('ssh://git@localhost:2222'),
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

export type Env = z.infer<typeof envSchema>

export const parseEnv = (environment: unknown) => envSchema.parse(environment)
