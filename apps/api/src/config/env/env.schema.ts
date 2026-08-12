import { z } from 'zod'

/**
 * Local development/test fallback for AUTH_SECRET. Kept identical to the
 * historical value so local DX is unchanged. This value is publicly known and
 * MUST never be accepted in production (see the superRefine guard below).
 */
const DEV_AUTH_SECRET_FALLBACK = 'development-auth-secret'

/** Minimum accepted AUTH_SECRET length in production. */
const AUTH_SECRET_MIN_LENGTH = 32

/**
 * Conservative low-entropy heuristic for AUTH_SECRET. Returns true when the
 * secret uses too few distinct characters (e.g. 'aaaa…' / '0000…'). A real
 * `openssl rand -hex 32` value has a 16-symbol alphabet (~13-16 distinct
 * chars) and base64 secrets are richer still, so the threshold safely passes
 * legitimate secrets while rejecting trivially repeated strings.
 */
const isLowEntropySecret = (value: string): boolean => new Set(value).size < 10

export const envSchema = z
	.object({
		// Fails closed: the API deployment (Dockerfile/railway.json/start scripts)
		// sets NODE_ENV nowhere, so an unset/unknown value must be treated as
		// production to engage the strong-secret guard below. The dev fallback is
		// only applied for an explicit 'development' or 'test' value.
		NODE_ENV: z
			.enum(['development', 'test', 'production'])
			.default('production'),
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
		GITHUB_MIRROR_SYNC_CRONTIME: z.string().default('*/30 * * * *'),
		GITHUB_MIRROR_SYNC_BATCH_SIZE: z.coerce
			.number()
			.int()
			.positive()
			.default(25),
		GITHUB_MIRROR_SYNC_INTERVAL_MINUTES: z.coerce
			.number()
			.int()
			.positive()
			.default(60),
		APP_URL: z.string().default('http://localhost:3000'),
		API_URL: z.string().default('http://localhost:4000'),
		API_GRPC_URL: z.string().default('localhost:50053'),
		AUTH_SECRET: z.string().min(1).optional(),
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
		GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
		GITHUB_APP_INSTALL_URL: z.url().optional(),
		GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
		GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
		GITHUB_SYNC_LEASE_MINUTES: z.coerce.number().int().positive().default(15),
		SENTRY_DSN: z.string().optional(),
		SENTRY_ENVIRONMENT: z.string().default('development'),
		SENTRY_RELEASE: z.string().optional(),
		RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
		SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
	})
	// Fail closed in production: reject a missing/known/weak AUTH_SECRET before
	// the transform fills it. A weak secret is exploitable (see the note in
	// packages/auth/server.ts re: the unconditional GET /api/auth/verify-email
	// change-email-verification branch), so a strong secret is the effective
	// control. In development/test no issues are added and the transform below
	// supplies the local fallback.
	.superRefine((env, ctx) => {
		if (env.NODE_ENV !== 'production') return

		if (env.AUTH_SECRET === undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['AUTH_SECRET'],
				message:
					'AUTH_SECRET is required in production; generate one with `openssl rand -hex 32`.',
			})
			return
		}

		if (env.AUTH_SECRET === DEV_AUTH_SECRET_FALLBACK)
			ctx.addIssue({
				code: 'custom',
				path: ['AUTH_SECRET'],
				message:
					'AUTH_SECRET must not use the known development fallback in production; generate one with `openssl rand -hex 32`.',
			})

		if (env.AUTH_SECRET.length < AUTH_SECRET_MIN_LENGTH)
			ctx.addIssue({
				code: 'custom',
				path: ['AUTH_SECRET'],
				message: `AUTH_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters in production; generate one with \`openssl rand -hex 32\`.`,
			})

		if (isLowEntropySecret(env.AUTH_SECRET))
			ctx.addIssue({
				code: 'custom',
				path: ['AUTH_SECRET'],
				message:
					'AUTH_SECRET has too little entropy for production; generate one with `openssl rand -hex 32`.',
			})
	})
	// Guarantee a string output. In production a missing/weak secret has already
	// aborted parsing above; in development/test the local fallback is applied.
	.transform(env => ({
		...env,
		AUTH_SECRET: env.AUTH_SECRET ?? DEV_AUTH_SECRET_FALLBACK,
	}))

export type Env = z.infer<typeof envSchema>

export const parseEnv = (environment: unknown) => envSchema.parse(environment)
