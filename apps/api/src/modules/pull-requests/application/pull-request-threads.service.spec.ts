import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequest } from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestThreadId,
	RepositoryId,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { ForbiddenError, NotFoundError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestNotFoundError } from '../domain/pull-request.errors'
import {
	PullRequestCommentForbiddenError,
	PullRequestCommentNotFoundError,
	PullRequestThreadNotFoundError,
	PullRequestThreadResolutionForbiddenError,
} from '../domain/pull-request-thread.errors'
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
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const comment = {
	id: commentId,
	threadId,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	body: 'Comment',
	state: 'published' as const,
	createdAt,
	updatedAt: createdAt,
	editedAt: null,
}
const thread: PullRequestThreadReadModel = {
	id: threadId,
	pullRequestId,
	kind: 'inline',
	path: 'src/index.ts',
	side: 'right',
	line: 7,
	anchorSha: 'anchor-sha',
	baseSha: 'base-current',
	headSha: 'head-current',
	lineExcerpt: 'const value = 1',
	resolvedAt: null,
	resolvedByUserId: null,
	resolvedByUsername: null,
	createdAt,
	updatedAt: createdAt,
	comments: [comment],
}

describe(PullRequestThreadsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestThreadsService
	let threadsRepository: PullRequestThreadsRepository
	let pullRequestsRepository: PullRequestsRepository
	let repositoriesService: RepositoriesService
	let gitStorageClient: GitStorageClient

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
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
						getReadableTesseraRepositoryContext: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: { compareRepositoryRefs: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestThreadsService)
		threadsRepository = moduleRef.get(PullRequestThreadsRepository)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		gitStorageClient = moduleRef.get(GitStorageClient)

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
			'getReadableTesseraRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'owner',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: 'base-current',
			headSha: 'head-current',
			mergeBaseSha: 'base-current',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})
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

	test('withholds every viewer capability on a GitHub-authoritative repository', async () => {
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
			canComment: false,
			canResolveAnyThread: false,
			canDeleteAnyComment: false,
		})
		expect(listSpy).toHaveBeenCalledOnce()
	})

	test('marks a thread outdated when the current head moves', async () => {
		vi.spyOn(threadsRepository, 'list').mockResolvedValue([thread])
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: thread.baseSha ?? '',
			headSha: 'moved-head',
			mergeBaseSha: thread.baseSha ?? '',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})

		expect(
			(await service.list(undefined, repositoryInput)).threads[0]?.outdated
		).toBeTruthy()
	})

	test.each([
		'owner',
		'admin',
		'write',
		'read',
	] as const)('allows %s repository users to create and reply', async viewerRole => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
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

	test('rejects thread mutations when repository context is unreadable or GitHub-authoritative', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
		).mockRejectedValue(new NotFoundError('repository'))

		await expect(invokeMutation(action)).rejects.toBeInstanceOf(NotFoundError)
	})

	test('masks an unreadable private repository as not found', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			comments: [{ ...comment, authorUserId: otherUserId }],
		})
		const resolveThreadSpy = vi
			.spyOn(threadsRepository, 'resolveThread')
			.mockResolvedValue(thread)
		const unresolveThreadSpy = vi
			.spyOn(threadsRepository, 'unresolveThread')
			.mockResolvedValue(thread)

		await service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		await service.unresolveThread(mockUserId, { ...repositoryInput, threadId })

		expect(resolveThreadSpy).toHaveBeenCalledOnce()
		expect(unresolveThreadSpy).toHaveBeenCalledOnce()
	})

	test('allows a read participant to resolve and unresolve', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'resolveThread').mockResolvedValue(thread)
		vi.spyOn(threadsRepository, 'unresolveThread').mockResolvedValue(thread)

		await service.resolveThread(mockUserId, { ...repositoryInput, threadId })
		await service.unresolveThread(mockUserId, { ...repositoryInput, threadId })
	})

	test.each([
		'resolveThread',
		'unresolveThread',
	] as const)('rejects a read non-participant calling %s', async action => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(threadsRepository, 'findThread').mockResolvedValue({
			...thread,
			comments: [{ ...comment, authorUserId: otherUserId }],
		})

		await expect(
			service[action](mockUserId, { ...repositoryInput, threadId })
		).rejects.toBeInstanceOf(PullRequestThreadResolutionForbiddenError)
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
