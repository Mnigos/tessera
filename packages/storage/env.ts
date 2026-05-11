import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const storageEnv = createEnv({
	server: {
		S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
		S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
		S3_BUCKET: z.string().default('tessera-dev'),
		S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
})
