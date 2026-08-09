import type { GitAccessTokenPermission } from '@repo/auth'
import type { MergeStrategySelection } from '@repo/contracts'
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

interface CreateSshPublicKeyOptions {
	apiBaseUrl: string
	headers: Headers
	publicKey: string
	title: string
}

interface PullRequestRepositoryOptions {
	apiBaseUrl: string
	headers?: Headers
	number?: number
	slug: string
	username: string
}

interface CreatePullRequestOptions extends PullRequestRepositoryOptions {
	sourceBranch?: string
	targetBranch?: string
	title?: string
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

export async function createSshPublicKey({
	apiBaseUrl,
	headers,
	publicKey,
	title,
}: CreateSshPublicKeyOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.sshPublicKeys.create({ publicKey, title })
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

export async function createPullRequest({
	apiBaseUrl,
	headers,
	slug,
	sourceBranch = 'feature',
	targetBranch = 'main',
	title = 'Merge feature',
	username,
}: CreatePullRequestOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.pullRequests.create({
		username,
		slug,
		sourceBranch,
		targetBranch,
		title,
	})
}

export async function comparePullRequest({
	apiBaseUrl,
	number = 1,
	headers,
	slug,
	username,
}: PullRequestRepositoryOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.pullRequests.comparison({ username, slug, number })
}

interface MergePullRequestOptions extends PullRequestRepositoryOptions {
	/** Defaults to the two-parent merge, which every history can take. */
	selection?: MergeStrategySelection
}

/**
 * Merges through the API against the refs the comparison currently reports,
 * which is what the web panel sends too.
 */
export async function mergePullRequest({
	apiBaseUrl,
	number = 1,
	headers,
	selection = { strategy: 'merge_commit' },
	slug,
	username,
}: MergePullRequestOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)
	const comparison = await orpc.pullRequests.comparison({
		username,
		slug,
		number,
	})

	return await orpc.pullRequests.merge({
		username,
		slug,
		number,
		expectedBaseSha: comparison.baseSha,
		expectedHeadSha: comparison.headSha,
		...selection,
	})
}

/** Merges with SHAs the caller chose, for the cases that must be refused. */
export async function mergePullRequestWithRefs({
	apiBaseUrl,
	expectedBaseSha,
	expectedHeadSha,
	number = 1,
	headers,
	selection = { strategy: 'merge_commit' },
	slug,
	username,
}: MergePullRequestOptions & {
	expectedBaseSha: string
	expectedHeadSha: string
}) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.pullRequests.merge({
		username,
		slug,
		number,
		expectedBaseSha,
		expectedHeadSha,
		...selection,
	})
}

export async function joinMergeQueue({
	apiBaseUrl,
	number = 1,
	headers,
	selection = { strategy: 'merge_commit' },
	slug,
	username,
}: MergePullRequestOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.pullRequests.joinMergeQueue({
		username,
		slug,
		number,
		...selection,
	})
}

export async function getPullRequest({
	apiBaseUrl,
	number = 1,
	headers,
	slug,
	username,
}: PullRequestRepositoryOptions) {
	const orpc = createGitE2EORPCClient(apiBaseUrl, headers)

	return await orpc.pullRequests.get({ username, slug, number })
}
