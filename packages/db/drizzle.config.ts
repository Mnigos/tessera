import { defineConfig } from 'drizzle-kit'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is required')
}

export default defineConfig({
	dialect: 'postgresql',
	casing: 'snake_case',
	out: './migrations',
	schema: './schema/index.ts',
	dbCredentials: {
		url: connectionString,
	},
})
