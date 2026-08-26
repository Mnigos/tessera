import {
	GitStorageClient,
	type GitStorageRepositoryComparison,
	type GitStorageRepositoryDiffLine,
	type GitStorageRepositoryFileDiff,
} from '@config/git-storage'
import { GitHubWriteThroughService } from '@modules/github-write-through'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequestChangedFileStatus } from '@repo/contracts'
import { pullRequestThreadAnchorInputSchema } from '@repo/contracts'
import type { PullRequest } from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { ForbiddenError, NotFoundError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import {
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestPendingReviewConflictError } from '../domain/pull-request-review.errors'
import {
	PullRequestCommentForbiddenError,
	PullRequestCommentNotFoundError,
	PullRequestThreadNotFoundError,
	PullRequestThreadResolutionForbiddenError,
	PullRequestThreadUnpublishedError,
} from '../domain/pull-request-thread.errors'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestThreadReadModel,
	PullRequestThreadsRepository,
} from '../infrastructure/pull-request-threads.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { PullRequestThreadsService } from './pull-request-threads.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const otherPullRequestId =
	'00000000-0000-4000-8000-000000000045' as PullRequestId
const threadId = '00000000-0000-4000-8000-000000000051' as PullRequestThreadId
const commentId = '00000000-0000-4000-8000-000000000052' as PullRequestCommentId
const otherUserId = '00000000-0000-4000-8000-000000000099' as UserId
const reviewId = '00000000-0000-4000-8000-000000000053' as PullRequestReviewId
const createdAt = new Date('2026-08-06T10:00:00Z')
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}
const pullRequest: PullRequest = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-opening',
	openingHeadSha: 'head-opening',
	title: 'Feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const unknownActor = {
	userId: null,
	username: null,
	displayName: null,
	imageUrl: null,
	externalNodeId: null,
	externalLogin: null,
	externalAvatarUrl: null,
	externalHtmlUrl: null,
}

function nativeActor(userId: UserId, username: string) {
	return { ...unknownActor, userId, username }
}

const comment = {
	id: commentId,
	threadId,
	provider: 'tessera' as const,
	authorUserId: mockUserId,
	author: nativeActor(mockUserId, 'marta'),
	body: 'Comment',
	state: 'published' as const,
	reviewId: null,
	createdAt,
	updatedAt: createdAt,
	editedAt: null,
	sourceUrl: null,
}
const thread: PullRequestThreadReadModel = {
	id: threadId,
	pullRequestId,
	provider: 'tessera',
	kind: 'inline',
	path: 'src/index.ts',
	side: 'right',
	startLine: null,
	line: 7,
	anchorSha: 'anchor-sha',
	baseSha: 'base-current',
	headSha: 'head-current',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	lineExcerpt: 'const value = 1',
	resolvedAt: null,
	resolvedByUserId: null,
	resolvedBy: unknownActor,
	providerOutdated: null,
	createdAt,
	updatedAt: createdAt,
	comments: [comment],
}

const changedFile = {
	status: 'modified' as PullRequestChangedFileStatus,
	oldPath: 'src/index.ts',
	newPath: 'src/index.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'other-head-blob',
	additions: 1,
	deletions: 0,
	isBinary: false,
}

function comparison(
	headSha: string,
	files: (typeof changedFile)[] = []
): GitStorageRepositoryComparison {
	return {
		baseSha: 'base-current',
		headSha,
		mergeBaseSha: 'base-current',
		commits: [],
		files,
		isTruncated: false,
		commitsTruncated: false,
		commitLimit: 500,
		fileLimit: 300,
	}
}

function fileDiff(
	lines: GitStorageRepositoryDiffLine[]
): GitStorageRepositoryFileDiff {
	return {
		baseSha: 'base-current',
		headSha: 'moved-head',
		mergeBaseSha: 'base-current',
		file: changedFile,
		hunks: [{ header: '@@', lines }],
		isTruncated: false,
		patchLimitBytes: 2_000_000,
	}
}

describe(PullRequestThreadsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestThreadsService
	let threadsRepository: PullRequestThreadsRepository
	let reviewsRepository: PullRequestReviewsRepository
	let pullRequestsRepository: PullRequestsRepository
	let repositoriesService: RepositoriesService
	let gitStorageClient: GitStorageClient
	let gitHubWriteThroughService: GitHubWriteThroughService

	function mockComparison(headSha: string, files?: (typeof changedFile)[]) {
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue(
			comparison(headSha, files)
		)
	}

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestThreadsService,
				{
					provide: PullRequestThreadsRepository,
					useValue: {
						list: vi.fn(),
						findThread: vi.fn(),
						findComment: vi.fn(),
						findCommentReadModel: vi.fn(),
						createThread: vi.fn(),
						createComment: vi.fn(),
						editComment: vi.fn(),
						deleteComment: vi.fn(),
						resolveThread: vi.fn(),
						unresolveThread: vi.fn(),
					},
				},
				{
					provide: PullRequestsRepository,
					useValue: { find: vi.fn() },
				},
				{
					provide: PullRequestReviewsRepository,
					useValue: { getOrCreatePendingReview: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						compareRepositoryRefs: vi.fn(),
						getRepositoryFileDiff: vi.fn(),
					},
				},
				{
					provide: GitHubWriteThroughService,
					useValue: {
						createThread: vi.fn(),
						replyThread: vi.fn(),
						editComment: vi.fn(),
						deleteComment: vi.fn(),
						setThreadResolution: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestThreadsService)
		threadsRepository = moduleRef.get(PullRequestThreadsRepository)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		gitStorageClient = moduleRef.get(GitStorageClient)
		gitHubWriteThroughService = moduleRef.get(GitHubWriteThroughService)

		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(pullRequest)
		mockComparison('head-current')
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists published threads with path and computes current anchors as not outdated', async () => {
		const listSpy = vi
			.spyOn(threadsRepository, 'list')
			.mockResolvedValue([thread])

		expect(
			await service.list(undefined, {
				...repositoryInput,
				path: thread.path ?? undefined,
			})
		).toMatchObject({ threads: [{ id: threadId, outdated: false }] })
		expect(listSpy).toHaveBeenCalledWith({ pullRequestId, path: thread.path })
	})

	test.each([
		['owner', true, true],
		['admin', true, true],
		['write', true, false],
		['read', false, false],
	] as const)('reports %s viewer capabilities alongside the listed threads', async (viewerRole, canResolveAnyThread, canDeleteAnyComment) => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])

		expect(
			(await service.list(mockUserId, repositoryInput)).viewer
		).toStrictEqual({
			canComment: true,
			canResolveAnyThread,
			canDeleteAnyComment,
		})
	})

	test('withholds every viewer capability from anonymous readers', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])

		expect(
			(await service.list(undefined, repositoryInput)).viewer
		).toStrictEqual({
			canComment: false,
			canResolveAnyThread: false,
			canDeleteAnyComment: false,
		})
	})

	test('keeps viewer capabilities on a GitHub-authoritative repository', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: false,
		})
		const listSpy = vi
			.spyOn(threadsRepository, 'list')
			.mockResolvedValue([thread])

		expect(
			(await service.list(mockUserId, repositoryInput)).viewer
		).toStrictEqual({
			canComment: true,
			canResolveAnyThread: true,
			canDeleteAnyComment: true,
		})
		expect(listSpy).toHaveBeenCalledOnce()
	})

	test('marks a thread outdated when the current head moves', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		mockComparison('moved-head')

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]?.outdated
		).toBeTruthy()
	})

	test('keeps a thread current when the push left its file untouched', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		mockComparison('moved-head', [
			{
				...changedFile,
				baseBlobId: 'other-base-blob',
				headBlobId: 'head-blob',
			},
		])

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]
		).toMatchObject({ outdated: false, currentAnchor: { endLine: 7 } })
		expect(gitStorageClient.getRepositoryFileDiff).not.toHaveBeenCalled()
	})

	test('re-anchors a thread whose line moved within a changed file', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		mockComparison('moved-head', [changedFile])
		vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockResolvedValue(
			fileDiff([
				{ content: 'const other = 2', kind: 'context', newLine: 7 },
				{ content: 'const value = 1', kind: 'addition', newLine: 11 },
			])
		)

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]
		).toMatchObject({
			outdated: false,
			currentAnchor: {
				path: 'src/index.ts',
				side: 'right',
				startLine: 11,
				endLine: 11,
			},
		})
	})

	test('places a re-anchored thread in the file its path was renamed to', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		mockComparison('moved-head', [
			{ ...changedFile, status: 'renamed' as const, newPath: 'src/entry.ts' },
		])
		vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockResolvedValue(
			fileDiff([{ content: 'const value = 1', kind: 'addition', newLine: 11 }])
		)

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]
		).toMatchObject({
			outdated: false,
			currentAnchor: { path: 'src/entry.ts', endLine: 11 },
		})
	})

	test('marks a thread outdated once its line left the diff', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		mockComparison('moved-head', [changedFile])
		vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockResolvedValue(
			fileDiff([{ content: 'const other = 2', kind: 'context', newLine: 7 }])
		)

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]
		).toMatchObject({ outdated: true, currentAnchor: undefined })
	})

	test.each([
		'owner',
		'admin',
		'write',
		'read',
	] as const)('allows %s repository users to create and reply', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		const createThreadSpy = vi
			.spyOn(threadsRepository, 'createThread')
			.mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		const createCommentSpy = vi
			.spyOn(threadsRepository, 'createComment')
			.mockResolvedValue(thread)

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Comment',
		})
		await service.replyThread(mockUserId, {
			...repositoryInput,
			threadId,
			body: 'Reply',
		})

		expect(createThreadSpy).toHaveBeenCalledOnce()
		expect(createCommentSpy).toHaveBeenCalledOnce()
	})

	test('dispatches mirrored thread writes with the GitHub context and bypasses native mutations', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId,
			authorUserId: mockUserId,
			state: 'published',
		})
		vi.spyOn(threadsRepository, 'findCommentReadModel').mockResolvedValue(
			comment
		)
		vi.spyOn(gitHubWriteThroughService, 'createThread').mockResolvedValue(
			threadId
		)
		vi.spyOn(gitHubWriteThroughService, 'replyThread').mockResolvedValue()
		vi.spyOn(gitHubWriteThroughService, 'editComment').mockResolvedValue()
		vi.spyOn(gitHubWriteThroughService, 'deleteComment').mockResolvedValue({
			threadDeleted: false,
		})
		vi.spyOn(
			gitHubWriteThroughService,
			'setThreadResolution'
		).mockResolvedValue()

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Comment',
		})
		await service.replyThread(mockUserId, {
			...repositoryInput,
			threadId,
			body: 'Reply',
		})
		await service.editComment(mockUserId, {
			...repositoryInput,
			commentId,
			body: 'Edited',
		})
		await service.deleteComment(mockUserId, {
			...repositoryInput,
			commentId,
		})
		await service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		await service.unresolveThread(mockUserId, { ...repositoryInput, threadId })

		const writeThrough = {
			actorUserId: mockUserId,
			externalRepository: { ownerLogin: 'tessera-org', name: 'notes' },
			pullRequestId,
			repositoryId,
		}
		expect(gitHubWriteThroughService.createThread).toHaveBeenCalledWith(
			writeThrough,
			{ body: 'Comment', inline: undefined }
		)
		expect(gitHubWriteThroughService.replyThread).toHaveBeenCalledWith(
			writeThrough,
			{ body: 'Reply', threadId, threadKind: 'inline' }
		)
		expect(gitHubWriteThroughService.editComment).toHaveBeenCalledWith(
			writeThrough,
			{ body: 'Edited', commentId }
		)
		expect(gitHubWriteThroughService.deleteComment).toHaveBeenCalledWith(
			writeThrough,
			{ commentId, threadId }
		)
		expect(
			vi.mocked(gitHubWriteThroughService.setThreadResolution).mock.calls
		).toEqual([
			[writeThrough, { resolved: true, threadId, threadKind: 'inline' }],
			[writeThrough, { resolved: false, threadId, threadKind: 'inline' }],
		])
		expect(threadsRepository.createThread).not.toHaveBeenCalled()
		expect(threadsRepository.createComment).not.toHaveBeenCalled()
		expect(threadsRepository.editComment).not.toHaveBeenCalled()
		expect(threadsRepository.deleteComment).not.toHaveBeenCalled()
		expect(threadsRepository.resolveThread).not.toHaveBeenCalled()
		expect(threadsRepository.unresolveThread).not.toHaveBeenCalled()
		expect(reviewsRepository.getOrCreatePendingReview).not.toHaveBeenCalled()
	})

	test('never touches write-through for a native thread write', async () => {
		vi.spyOn(threadsRepository, 'createThread').mockResolvedValue(thread)

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Native comment',
		})

		expect(gitHubWriteThroughService.createThread).not.toHaveBeenCalled()
		expect(threadsRepository.createThread).toHaveBeenCalledOnce()
	})

	test('rejects a reversed range at the contract boundary', () => {
		expect(
			pullRequestThreadAnchorInputSchema.safeParse({
				path: 'src/index.ts',
				side: 'right',
				startLine: 8,
				endLine: 7,
				anchorSha: 'anchor-sha',
				baseSha: 'base-current',
				headSha: 'head-current',
				lineExcerpt: 'const value = 1',
			}).success
		).toBeFalsy()
	})

	test('rejects an inline anchor after the comparison head moves', async () => {
		const promise = service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Stale inline comment',
			anchor: {
				path: 'src/index.ts',
				side: 'right',
				startLine: 7,
				endLine: 7,
				anchorSha: 'old-head',
				baseSha: 'base-current',
				headSha: 'old-head',
				lineExcerpt: 'const value = 1',
			},
		})

		await expect(promise).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof PullRequestStaleComparisonError &&
				error.context?.anchorHeadSha === 'old-head' &&
				error.context?.headSha === 'head-current'
		)
		expect(threadsRepository.createThread).not.toHaveBeenCalled()
		expect(gitHubWriteThroughService.createThread).not.toHaveBeenCalled()
	})

	test('uses the resolved current head as a mirrored range commit id', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(gitHubWriteThroughService, 'createThread').mockResolvedValue(
			threadId
		)
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			startLine: 5,
		})
		const anchor = {
			path: 'src/index.ts',
			side: 'right' as const,
			startLine: 5,
			endLine: 7,
			anchorSha: 'head-current',
			baseSha: 'base-current',
			headSha: 'head-current',
			lineExcerpt: 'const value = 1',
		}

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Range comment',
			anchor,
		})

		expect(gitHubWriteThroughService.createThread).toHaveBeenCalledWith(
			{
				actorUserId: mockUserId,
				externalRepository: { ownerLogin: 'tessera-org', name: 'notes' },
				pullRequestId,
				repositoryId,
			},
			{
				body: 'Range comment',
				inline: { anchor, headSha: 'head-current' },
			}
		)
		expect(threadsRepository.createThread).not.toHaveBeenCalled()
	})

	test('keeps a mirrored inline comment a local draft when it joins a review', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(reviewsRepository, 'getOrCreatePendingReview').mockResolvedValue(
			reviewId
		)
		vi.spyOn(threadsRepository, 'createThread').mockResolvedValue(thread)
		const anchor = {
			path: 'src/index.ts',
			side: 'right' as const,
			startLine: 7,
			endLine: 7,
			anchorSha: 'head-current',
			baseSha: 'base-current',
			headSha: 'head-current',
			lineExcerpt: 'const value = 1',
		}

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Batched comment',
			anchor,
			review: { expectedHeadSha: 'head-current' },
		})

		expect(gitHubWriteThroughService.createThread).not.toHaveBeenCalled()
		expect(threadsRepository.createThread).toHaveBeenCalledWith(
			expect.objectContaining({ anchor, reviewId })
		)
	})

	test('rejects thread mutations when repository context is unreadable or GitHub-authoritative', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockRejectedValue(new ForbiddenError('repository'))

		await expect(
			service.createThread(mockUserId, { ...repositoryInput, body: 'Comment' })
		).rejects.toBeInstanceOf(ForbiddenError)
		expect(threadsRepository.createThread).not.toHaveBeenCalled()
	})

	test.each([
		'create',
		'reply',
		'edit',
		'delete',
		'resolve',
		'unresolve',
	] as const)('rejects %s when GitHub is authoritative', async action => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockRejectedValue(new ForbiddenError('repository'))

		await expect(invokeMutation(action)).rejects.toBeInstanceOf(ForbiddenError)
	})

	test.each([
		'create',
		'reply',
		'edit',
		'delete',
		'resolve',
		'unresolve',
	] as const)('masks %s from a user with no private-repository access', async action => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockRejectedValue(new NotFoundError('repository'))

		await expect(invokeMutation(action)).rejects.toBeInstanceOf(NotFoundError)
	})

	test('masks an unreadable private repository as not found', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockRejectedValue(new NotFoundError('repository'))

		await expect(
			service.replyThread(otherUserId, {
				...repositoryInput,
				threadId,
				body: 'Reply',
			})
		).rejects.toBeInstanceOf(NotFoundError)
	})

	test.each([
		'owner',
		'admin',
		'write',
		'read',
	] as const)('allows a %s comment author to edit and delete their own comment', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId,
			authorUserId: mockUserId,
			state: 'published',
		})
		const editCommentSpy = vi
			.spyOn(threadsRepository, 'editComment')
			.mockResolvedValue(comment)
		const deleteCommentSpy = vi
			.spyOn(threadsRepository, 'deleteComment')
			.mockResolvedValue(false)

		await service.editComment(mockUserId, {
			...repositoryInput,
			commentId,
			body: 'Edited',
		})
		await service.deleteComment(mockUserId, { ...repositoryInput, commentId })

		expect(editCommentSpy).toHaveBeenCalledOnce()
		expect(deleteCommentSpy).toHaveBeenCalledOnce()
	})

	test.each([
		'owner',
		'admin',
	] as const)('allows %s to delete another authors comment', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId,
			authorUserId: otherUserId,
			state: 'published',
		})
		const deleteCommentSpy = vi
			.spyOn(threadsRepository, 'deleteComment')
			.mockResolvedValue(false)

		await service.deleteComment(mockUserId, { ...repositoryInput, commentId })

		expect(deleteCommentSpy).toHaveBeenCalledOnce()
	})

	test.each([
		'write',
		'read',
	] as const)('rejects %s deleting another authors comment', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId,
			authorUserId: otherUserId,
			state: 'published',
		})

		await expect(
			service.deleteComment(mockUserId, { ...repositoryInput, commentId })
		).rejects.toBeInstanceOf(PullRequestCommentForbiddenError)
	})

	test.each([
		'owner',
		'admin',
		'write',
		'read',
	] as const)('rejects %s editing another authors comment', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId,
			authorUserId: otherUserId,
			state: 'published',
		})

		await expect(
			service.editComment(mockUserId, {
				...repositoryInput,
				commentId,
				body: 'Edited',
			})
		).rejects.toBeInstanceOf(PullRequestCommentForbiddenError)
	})

	test.each([
		'owner',
		'admin',
		'write',
	] as const)('allows %s to resolve and unresolve any thread', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			comments: [
				{
					...comment,
					authorUserId: otherUserId,
					author: nativeActor(otherUserId, 'otter'),
				},
			],
		})
		const resolveThreadSpy = vi
			.spyOn(threadsRepository, 'resolveThread')
			.mockResolvedValue({ status: 'updated', thread })
		const unresolveThreadSpy = vi
			.spyOn(threadsRepository, 'unresolveThread')
			.mockResolvedValue({ status: 'updated', thread })

		await service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		await service.unresolveThread(mockUserId, { ...repositoryInput, threadId })

		expect(resolveThreadSpy).toHaveBeenCalledOnce()
		expect(unresolveThreadSpy).toHaveBeenCalledOnce()
	})

	test('allows a read participant to resolve and unresolve', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'resolveThread').mockResolvedValue({
			status: 'updated',
			thread,
		})
		vi.spyOn(threadsRepository, 'unresolveThread').mockResolvedValue({
			status: 'updated',
			thread,
		})

		await service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		await service.unresolveThread(mockUserId, { ...repositoryInput, threadId })
	})

	test.each([
		'resolveThread',
		'unresolveThread',
	] as const)('rejects a read non-participant calling %s', async action => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			comments: [
				{
					...comment,
					authorUserId: otherUserId,
					author: nativeActor(otherUserId, 'otter'),
				},
			],
		})

		await expect(
			service[action](mockUserId, { ...repositoryInput, threadId })
		).rejects.toBeInstanceOf(PullRequestThreadResolutionForbiddenError)
	})

	test.each([
		'resolveThread',
		'unresolveThread',
	] as const)('rejects %s on a thread holding only pending draft comments', async action => {
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			comments: [{ ...comment, state: 'pending', reviewId }],
		})

		await expect(
			service[action](mockUserId, { ...repositoryInput, threadId })
		).rejects.toBeInstanceOf(PullRequestThreadUnpublishedError)
		expect(threadsRepository[action]).not.toHaveBeenCalled()
	})

	test.each([
		{
			result: { status: 'thread_unpublished' } as const,
			error: PullRequestThreadUnpublishedError,
		},
		{
			result: { status: 'thread_not_found' } as const,
			error: PullRequestThreadNotFoundError,
		},
	])('reports $result.status observed under the thread lock', async ({
		error,
		result,
	}) => {
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'resolveThread').mockResolvedValue(result)
		vi.spyOn(threadsRepository, 'unresolveThread').mockResolvedValue(result)

		await expect(
			service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		).rejects.toBeInstanceOf(error)
		await expect(
			service.unresolveThread(mockUserId, { ...repositoryInput, threadId })
		).rejects.toBeInstanceOf(error)
	})

	test.each([
		'create',
		'reply',
	] as const)('reports a conflict when %s loses the pending review it targeted', async action => {
		vi.spyOn(reviewsRepository, 'getOrCreatePendingReview').mockResolvedValue(
			reviewId
		)
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'createThread').mockResolvedValue(undefined)
		vi.spyOn(threadsRepository, 'createComment').mockResolvedValue(undefined)

		const mutation =
			action === 'create'
				? service.createThread(otherUserId, {
						...repositoryInput,
						body: 'Draft finding',
						review: { expectedHeadSha: 'head-current' },
					})
				: service.replyThread(otherUserId, {
						...repositoryInput,
						threadId,
						body: 'Draft reply',
						review: { expectedHeadSha: 'head-current' },
					})

		await expect(mutation).rejects.toBeInstanceOf(
			PullRequestPendingReviewConflictError
		)
	})

	test('rejects joining a pending review the pull request no longer accepts', async () => {
		vi.spyOn(reviewsRepository, 'getOrCreatePendingReview').mockResolvedValue(
			undefined
		)

		await expect(
			service.createThread(otherUserId, {
				...repositoryInput,
				body: 'Draft finding',
				review: { expectedHeadSha: 'head-current' },
			})
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
		expect(threadsRepository.createThread).not.toHaveBeenCalled()
	})

	test('allows the author to start and add to a pending comment review', async () => {
		vi.spyOn(reviewsRepository, 'getOrCreatePendingReview').mockResolvedValue(
			reviewId
		)
		vi.spyOn(threadsRepository, 'createThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'createComment').mockResolvedValue(thread)
		const review = { expectedHeadSha: 'head-current' }

		await service.createThread(mockUserId, {
			...repositoryInput,
			body: 'Author draft finding',
			review,
		})
		await service.replyThread(mockUserId, {
			...repositoryInput,
			threadId,
			body: 'Author draft reply',
			review,
		})

		expect(reviewsRepository.getOrCreatePendingReview).toHaveBeenCalledTimes(2)
		expect(threadsRepository.createThread).toHaveBeenCalledWith(
			expect.objectContaining({
				authorUserId: mockUserId,
				reviewId,
			})
		)
		expect(threadsRepository.createComment).toHaveBeenCalledWith(
			expect.objectContaining({
				authorUserId: mockUserId,
				reviewId,
			})
		)
	})

	test('rejects cross-PR thread access', async () => {
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			pullRequestId: otherPullRequestId,
		})

		await expect(
			service.replyThread(mockUserId, {
				...repositoryInput,
				threadId,
				body: 'Reply',
			})
		).rejects.toBeInstanceOf(PullRequestThreadNotFoundError)
	})

	test('rejects cross-PR comment access', async () => {
		vi.spyOn(threadsRepository, 'findComment').mockResolvedValue({
			id: commentId,
			threadId,
			pullRequestId: otherPullRequestId,
			authorUserId: mockUserId,
			state: 'published',
		})

		await expect(
			service.editComment(mockUserId, {
				...repositoryInput,
				commentId,
				body: 'Edited',
			})
		).rejects.toBeInstanceOf(PullRequestCommentNotFoundError)
	})

	test('rejects missing pull requests', async () => {
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(undefined)

		await expect(
			service.createThread(mockUserId, { ...repositoryInput, body: 'Comment' })
		).rejects.toBeInstanceOf(PullRequestNotFoundError)
	})

	function invokeMutation(
		action: 'create' | 'delete' | 'edit' | 'reply' | 'resolve' | 'unresolve'
	) {
		switch (action) {
			case 'create':
				return service.createThread(mockUserId, {
					...repositoryInput,
					body: 'Comment',
				})
			case 'reply':
				return service.replyThread(mockUserId, {
					...repositoryInput,
					threadId,
					body: 'Reply',
				})
			case 'edit':
				return service.editComment(mockUserId, {
					...repositoryInput,
					commentId,
					body: 'Edited',
				})
			case 'delete':
				return service.deleteComment(mockUserId, {
					...repositoryInput,
					commentId,
				})
			case 'resolve':
				return service.resolveThread(mockUserId, {
					...repositoryInput,
					threadId,
				})
			case 'unresolve':
				return service.unresolveThread(mockUserId, {
					...repositoryInput,
					threadId,
				})
			default:
				throw new Error(`Unsupported mutation: ${action}`)
		}
	}
})
