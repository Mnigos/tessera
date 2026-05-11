import type { S3Client } from '@repo/storage'

export abstract class Storage extends (class {} as new () => S3Client) {}
