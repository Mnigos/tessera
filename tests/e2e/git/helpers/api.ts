import type { GitAccessTokenPermission } from '@repo/auth'
import { session, user } from '@repo/db'
import { db } from '@repo/db/client'
import { makeSignature } from 'better-auth/crypto'
import { createGitE2EORPCClient } from './orpc-client'

interface CreateTestSessionOptions {
	apiBaseUrl: string
	email: string
	name?: string
	username: string
}

interface CreateRepositoryOptions {
	apiBaseUrl: string
	headers: Headers
	name: string
	slug?: string
	visibility?: 'private' | 'public'
}

interface CreateGitAccessTokenOptions {
	apiBaseUrl: string
	headers: Headers
	permissions: GitAccessTokenPermission[]
}

export async function createTestSessionHeaders({
	apiBaseUrl,
	email,
	name,
	username,
}: CreateTestSessionOptions) {
	const token = crypto.randomUUID()
	const createdUsers = await db
		.insert(user)
		.values({
			email,
			emailVerified: true,
			name: name ?? username,
			username,
		})
		.returning({ id: user.id })
	const createdUser = createdUsers[0]

	if (!createdUser) throw new Error('failed to create e2e user')

	await db.insert(session).values({
		expiresAt: new Date(Date.now() + 86_400_000),
		token,
		userId: createdUser.id,
	})

	const headers = new Headers()
	headers.set(
		'cookie',
		`better-auth.session_token=${token}.${await makeSignature(
			token,
			'test-auth-secret'
		)}`
	)
	headers.set('origin', apiBaseUrl)

	return headers
}

export async function createRepository({
	apiBaseUrl,
	headers,
	name,
	slug,
	visibility = 'private',
}: CreateRepositoryOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.repositories.create({ name, slug, visibility })
}

export async function createGitAccessToken({
	apiBaseUrl,
	headers,
	permissions,
}: CreateGitAccessTokenOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)
	const body = await orpc.gitAccessTokens.create({
		name: `E2E ${permissions.join(',')}`,
		permissions,
	})

	return body.token
}

export async function getBlobPreview(
	apiBaseUrl: string,
	username: string,
	slug: string,
	path: string,
	headers?: Headers
) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)
	const body = await orpc.repositories.getBlob({
		path,
		ref: 'main',
		slug,
		username,
	})

	return body.preview
}

export async function getBrowserSummary(
	apiBaseUrl: string,
	username: string,
	slug: string,
	headers?: Headers
) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.repositories.getBrowserSummary({ slug, username })
}
