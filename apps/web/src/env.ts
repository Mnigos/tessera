import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
	clientPrefix: 'VITE_',
	server: {
		API_URL: z.url().default('http://localhost:4000'),
	},
	client: {
		VITE_API_URL: z.url().default('http://localhost:4000'),
		VITE_APP_URL: z.url().default('http://localhost:3000'),
		VITE_PUBLIC_GIT_HTTP_BASE_URL: z.url(),
	},
	runtimeEnv: {
		API_URL: process.env.API_URL,
		VITE_API_URL: import.meta.env?.VITE_API_URL,
		VITE_APP_URL: import.meta.env?.VITE_APP_URL,
		VITE_PUBLIC_GIT_HTTP_BASE_URL: import.meta.env
			?.VITE_PUBLIC_GIT_HTTP_BASE_URL,
	},
	skipValidation:
		import.meta.env?.GITHUB_ACTIONS === 'true' || !!import.meta.env?.CI,
})
