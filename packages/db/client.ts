import { instrumentDrizzleClient } from '@kubiks/otel-drizzle'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString =
	process.env.DATABASE_URL ??
	'postgresql://tessera:tessera@localhost:5432/tessera'
const DEFAULT_DB_POOL_MAX = 5
const DEFAULT_DB_IDLE_TIMEOUT_SECONDS = 30
const DEFAULT_DB_CONNECT_TIMEOUT_SECONDS = 10

function parsePositiveInteger(value: string | undefined, fallback: number) {
	const parsedValue = Number(value)

	if (!Number.isFinite(parsedValue) || parsedValue <= 0) return fallback

	return Math.trunc(parsedValue)
}

const poolMax = parsePositiveInteger(
	process.env.DB_POOL_MAX,
	DEFAULT_DB_POOL_MAX
)
const idleTimeoutSeconds = parsePositiveInteger(
	process.env.DB_IDLE_TIMEOUT_SECONDS,
	DEFAULT_DB_IDLE_TIMEOUT_SECONDS
)
const connectTimeoutSeconds = parsePositiveInteger(
	process.env.DB_CONNECT_TIMEOUT_SECONDS,
	DEFAULT_DB_CONNECT_TIMEOUT_SECONDS
)

const client = postgres(connectionString, {
	max: poolMax,
	idle_timeout: idleTimeoutSeconds,
	connect_timeout: connectTimeoutSeconds,
})

export const db = drizzle(client, { schema, casing: 'snake_case' })

try {
	instrumentDrizzleClient(db, {
		dbSystem: 'postgresql',
		captureQueryText: true,
		maxQueryTextLength: 1000,
	})
} catch (error) {
	console.warn(
		'Failed to initialize drizzle OpenTelemetry instrumentation',
		error
	)
}

export type DrizzleTransaction = Parameters<
	Parameters<(typeof db)['transaction']>[0]
>[0]
