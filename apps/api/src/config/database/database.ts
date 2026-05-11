import type { PostgresJsDatabase } from '@repo/db'
import type * as schema from '@repo/db/schema'

type Schema = typeof schema

export abstract class Database extends (class {} as new () => PostgresJsDatabase<Schema>) {}
