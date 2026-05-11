import { S3Client } from 'bun'

import { storageEnv } from './env'

export const storage = new S3Client({
	accessKeyId: storageEnv.S3_ACCESS_KEY_ID,
	secretAccessKey: storageEnv.S3_SECRET_ACCESS_KEY,
	bucket: storageEnv.S3_BUCKET,
	endpoint: storageEnv.S3_ENDPOINT,
})
