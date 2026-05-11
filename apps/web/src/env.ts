import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const importMetaEnv = (
	import.meta as ImportMeta & {
		env?: Record<string, string | undefined>
	}
).env

export const env = createEnv({
	clientPrefix: 'VITE_',
	server: {
		API_URL: z.url().default('http://localhost:4000'),
	},
	client: {
		VITE_API_URL: z.url().default('http://localhost:4000'),
		VITE_APP_URL: z.url().default('http://localhost:3000'),
	},
	runtimeEnv: {
		API_URL: process.env.API_URL,
		VITE_API_URL: importMetaEnv?.VITE_API_URL,
		VITE_APP_URL: importMetaEnv?.VITE_APP_URL,
	},
	skipValidation:
		importMetaEnv?.GITHUB_ACTIONS === 'true' || !!importMetaEnv?.CI,
})
