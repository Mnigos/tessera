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
	INTERNAL_API_TOKEN: z.string().min(1),
	CACHE_REDIS_DB: z.coerce.number().int().min(0).default(1),
	BULL_BOARD_PATH: z.string().default('/admin/queues'),
	BULL_BOARD_USERNAME: z.string().optional(),
	BULL_BOARD_PASSWORD: z.string().optional(),
	APP_URL: z.string().default('http://localhost:3000'),
	API_URL: z.string().default('http://localhost:4000'),
	API_GRPC_URL: z.string().default('localhost:50053'),
	AUTH_SECRET: z.string().default('development-auth-secret'),
	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
	SENTRY_DSN: z.string().optional(),
	SENTRY_ENVIRONMENT: z.string().default('development'),
	SENTRY_RELEASE: z.string().optional(),
	RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
	SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
})

export type Env = z.infer<typeof envSchema>

export const parseEnv = (environment: unknown) => envSchema.parse(environment)
