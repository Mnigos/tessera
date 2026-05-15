import { sql } from '@repo/db'
import { db } from '@repo/db/client'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const migrationsFolder = new URL(
	'../../../../packages/db/migrations',
	import.meta.url
).pathname

export async function migrateGitE2EDatabase() {
	await migrate(db, { migrationsFolder })
}

export async function resetGitE2EDatabase() {
	const result = await db.execute<{ tablename: string }>(sql`
		select tablename
		from pg_tables
		where schemaname = 'public'
			and tablename <> '__drizzle_migrations'
	`)
	const tableNames = result.map(({ tablename }) => tablename)

	if (tableNames.length === 0) return

	await db.execute(
		sql.raw(
			`truncate table ${tableNames.map(tableName => `"${tableName}"`).join(', ')} restart identity cascade`
		)
	)
}
