import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	and,
	eq,
	inArray,
	or,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviews,
	pullRequestThreads,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestThreadsRepository } from './pull-request-threads.repository'

const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const threadId = '00000000-0000-4000-8000-000000000051' as PullRequestThreadId
const commentId = '00000000-0000-4000-8000-000000000052' as PullRequestCommentId
const reviewId = '00000000-0000-4000-8000-000000000053' as PullRequestReviewId
const createdAt = new Date('2026-08-06T10:00:00Z')
const thread = {
	id: threadId,
	pullRequestId,
	kind: 'inline' as const,
	path: 'src/index.ts',
	side: 'right' as const,
	line: 7,
	anchorSha: 'a'.repeat(40),
	baseSha: 'b'.repeat(40),
	headSha: 'c'.repeat(40),
	lineExcerpt: 'const value = 1',
	resolvedAt: null,
	resolvedByUserId: null,
	resolvedByUsername: null,
	createdAt,
	updatedAt: createdAt,
}
const comment = {
	id: commentId,
	threadId,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	body: 'Comment',
	state: 'published' as const,
	reviewId: null,
	createdAt,
	updatedAt: createdAt,
	editedAt: null,
}

describe(PullRequestThreadsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestThreadsRepository

	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const fromMock = vi.fn()
	const joinMock = vi.fn()
	const whereMock = vi.fn()
	const orderByMock = vi.fn()
	const limitMock = vi.fn()
	const forMock = vi.fn()
	const insertMock = vi.fn()
	const databaseInsertMock = vi.fn()
	const valuesMock = vi.fn()
	const returningMock = vi.fn()
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()

	beforeEach(async () => {
		vi.resetAllMocks()
		orderByMock.mockResolvedValue([])
		limitMock.mockResolvedValue([])
		forMock.mockResolvedValue([])
		whereMock.mockReturnValue({
			orderBy: orderByMock,
			limit: limitMock,
			returning: returningMock,
			for: forMock,
		})
		joinMock.mockReturnValue({ where: whereMock })
		fromMock.mockReturnValue({
			leftJoin: joinMock,
			innerJoin: joinMock,
			where: whereMock,
		})
		selectMock.mockReturnValue({ from: fromMock })
		returningMock.mockResolvedValue([])
		valuesMock.mockReturnValue({ returning: returningMock })
		insertMock.mockReturnValue({ values: valuesMock })
		databaseInsertMock.mockReturnValue({ values: valuesMock })
		setMock.mockReturnValue({ where: whereMock })
		updateMock.mockReturnValue({ set: setMock })
		deleteWhereMock.mockResolvedValue(undefined)
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		const tx = {
			select: selectMock,
			insert: insertMock,
			update: updateMock,
			delete: deleteMock,
		}
		transactionMock.mockImplementation(callback => callback(tx))

		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestThreadsRepository,
				{
					provide: Database,
					useValue: {
						...tx,
						insert: databaseInsertMock,
						transaction: transactionMock,
					},
				},
			],
		}).compile()
		repository = moduleRef.get(PullRequestThreadsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates an inline thread, published comment, and commented event in one transaction', async () => {
		returningMock
			.mockResolvedValueOnce([
				{ id: threadId, kind: 'inline', path: thread.path },
			])
			.mockResolvedValueOnce([{ id: commentId }])
		limitMock.mockResolvedValueOnce([thread])
		orderByMock.mockResolvedValueOnce([comment])
		const anchor = {
			path: thread.path,
			side: thread.side,
			line: thread.line,
			anchorSha: thread.anchorSha,
			baseSha: thread.baseSha,
			headSha: thread.headSha,
			lineExcerpt: thread.lineExcerpt,
		}

		expect(
			await repository.createThread({
				pullRequestId,
				authorUserId: mockUserId,
				body: comment.body,
				anchor,
			})
		).toEqual({ ...thread, comments: [comment] })
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(databaseInsertMock).not.toHaveBeenCalled()
		expect(insertMock).toHaveBeenNthCalledWith(1, pullRequestThreads)
		expect(valuesMock).toHaveBeenNthCalledWith(1, {
			pullRequestId,
			kind: 'inline',
			...anchor,
		})
		expect(insertMock).toHaveBeenNthCalledWith(2, pullRequestComments)
		expect(valuesMock).toHaveBeenNthCalledWith(2, {
			threadId,
			authorUserId: mockUserId,
			body: comment.body,
			reviewId: undefined,
			state: 'published',
		})
		expect(insertMock).toHaveBeenNthCalledWith(3, pullRequestEvents)
		expect(valuesMock).toHaveBeenNthCalledWith(3, {
			pullRequestId,
			actorUserId: mockUserId,
			type: 'commented',
			payload: {
				threadId,
				commentId,
				threadKind: 'inline',
				path: thread.path,
			},
		})
	})

	test('replies and records a commented event in one transaction', async () => {
		returningMock.mockResolvedValueOnce([{ id: commentId }])
		limitMock.mockResolvedValueOnce([thread])
		orderByMock.mockResolvedValueOnce([comment])

		await repository.createComment({
			pullRequestId,
			threadId,
			authorUserId: mockUserId,
			body: 'Reply',
		})

		expect(transactionMock).toHaveBeenCalledOnce()
		expect(databaseInsertMock).not.toHaveBeenCalled()
		expect(valuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'commented',
			payload: {
				threadId,
				commentId,
				threadKind: 'inline',
				path: thread.path,
			},
		})
	})

	test.each([
		{ action: 'resolveThread' as const, type: 'thread_resolved' as const },
		{ action: 'unresolveThread' as const, type: 'thread_unresolved' as const },
	])('records $type with thread metadata in the mutation transaction', async ({
		action,
		type,
	}) => {
		forMock.mockResolvedValueOnce([{ id: threadId }])
		limitMock.mockResolvedValueOnce([comment]).mockResolvedValueOnce([thread])
		returningMock.mockResolvedValueOnce([{ kind: 'inline', path: thread.path }])
		orderByMock.mockResolvedValueOnce([comment])

		const result =
			action === 'resolveThread'
				? await repository.resolveThread({
						pullRequestId,
						threadId,
						actorUserId: mockUserId,
						resolvedAt: createdAt,
					})
				: await repository.unresolveThread({
						pullRequestId,
						threadId,
						actorUserId: mockUserId,
					})

		expect(result).toEqual({
			status: 'updated',
			thread: { ...thread, comments: [comment] },
		})
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(databaseInsertMock).not.toHaveBeenCalled()
		expect(forMock).toHaveBeenCalledWith('update')
		expect(valuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type,
			payload: {
				threadId,
				threadKind: 'inline',
				path: thread.path,
			},
		})

		const [lockOrder = 0] = forMock.mock.invocationCallOrder
		const [updateOrder = 0] = updateMock.mock.invocationCallOrder
		expect(lockOrder).toBeLessThan(updateOrder)
	})

	test.each([
		{
			action: 'resolveThread' as const,
			status: 'thread_unpublished' as const,
			lockedThreads: [{ id: threadId }],
			publishedComments: [],
		},
		{
			action: 'unresolveThread' as const,
			status: 'thread_unpublished' as const,
			lockedThreads: [{ id: threadId }],
			publishedComments: [],
		},
		{
			action: 'resolveThread' as const,
			status: 'thread_not_found' as const,
			lockedThreads: [],
			publishedComments: [],
		},
		{
			action: 'unresolveThread' as const,
			status: 'thread_not_found' as const,
			lockedThreads: [],
			publishedComments: [],
		},
	])('reports $status from $action once the thread lock is held', async ({
		action,
		lockedThreads,
		publishedComments,
		status,
	}) => {
		forMock.mockResolvedValueOnce(lockedThreads)
		limitMock.mockResolvedValueOnce(publishedComments)

		const result =
			action === 'resolveThread'
				? await repository.resolveThread({
						pullRequestId,
						threadId,
						actorUserId: mockUserId,
						resolvedAt: createdAt,
					})
				: await repository.unresolveThread({
						pullRequestId,
						threadId,
						actorUserId: mockUserId,
					})

		expect(result).toEqual({ status })
		expect(updateMock).not.toHaveBeenCalled()
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('lists path-filtered threads and only published comments', async () => {
		orderByMock.mockResolvedValueOnce([thread]).mockResolvedValueOnce([comment])

		expect(await repository.list({ pullRequestId, path: thread.path })).toEqual(
			[{ ...thread, comments: [comment] }]
		)
		expect(whereMock).toHaveBeenCalledTimes(2)
		expect(whereMock).toHaveBeenNthCalledWith(
			1,
			and(
				eq(pullRequestThreads.pullRequestId, pullRequestId),
				eq(pullRequestThreads.path, thread.path)
			)
		)
		expect(whereMock).toHaveBeenNthCalledWith(
			2,
			and(
				inArray(pullRequestComments.threadId, [threadId]),
				eq(pullRequestComments.state, 'published')
			)
		)
		expect(orderByMock).toHaveBeenCalledTimes(2)
	})

	test('shows a reviewer their pending comments and hides them from everyone else', async () => {
		const pendingComment = {
			...comment,
			state: 'pending' as const,
			reviewId,
		}
		orderByMock
			.mockResolvedValueOnce([thread])
			.mockResolvedValueOnce([pendingComment])

		expect(
			await repository.list({ pullRequestId, viewerUserId: mockUserId })
		).toEqual([{ ...thread, comments: [pendingComment] }])
		expect(whereMock).toHaveBeenNthCalledWith(
			2,
			and(
				inArray(pullRequestComments.threadId, [threadId]),
				or(
					eq(pullRequestComments.state, 'published'),
					and(
						eq(pullRequestComments.state, 'pending'),
						eq(pullRequestComments.authorUserId, mockUserId)
					)
				)
			)
		)

		vi.clearAllMocks()
		orderByMock.mockResolvedValueOnce([thread]).mockResolvedValueOnce([])
		whereMock.mockReturnValue({
			orderBy: orderByMock,
			limit: limitMock,
			returning: returningMock,
			for: forMock,
		})

		expect(await repository.list({ pullRequestId })).toEqual([])
	})

	test('inserts pending review comments without emitting timeline events', async () => {
		forMock.mockResolvedValueOnce([{ id: reviewId }])
		returningMock
			.mockResolvedValueOnce([{ id: threadId, kind: 'top_level', path: null }])
			.mockResolvedValueOnce([{ id: commentId }])
		limitMock.mockResolvedValueOnce([thread])
		orderByMock.mockResolvedValueOnce([
			{ ...comment, state: 'pending', reviewId },
		])

		await repository.createThread({
			pullRequestId,
			authorUserId: mockUserId,
			body: 'Draft finding',
			reviewId,
		})

		expect(whereMock).toHaveBeenNthCalledWith(
			1,
			and(
				eq(pullRequestReviews.id, reviewId),
				eq(pullRequestReviews.state, 'pending')
			)
		)
		expect(forMock).toHaveBeenCalledWith('update')
		expect(valuesMock).toHaveBeenNthCalledWith(2, {
			threadId,
			authorUserId: mockUserId,
			body: 'Draft finding',
			reviewId,
			state: 'pending',
		})
		expect(insertMock).not.toHaveBeenCalledWith(pullRequestEvents)
	})

	test.each([
		{ action: 'createThread' as const },
		{ action: 'createComment' as const },
	])('refuses $action once the pending review is no longer pending', async ({
		action,
	}) => {
		forMock.mockResolvedValueOnce([])

		const result =
			action === 'createThread'
				? await repository.createThread({
						pullRequestId,
						authorUserId: mockUserId,
						body: 'Draft finding',
						reviewId,
					})
				: await repository.createComment({
						pullRequestId,
						threadId,
						authorUserId: mockUserId,
						body: 'Draft reply',
						reviewId,
					})

		expect(result).toBeUndefined()
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('hides a thread whose comments are all somebody else pending draft', async () => {
		limitMock.mockResolvedValueOnce([thread])
		orderByMock.mockResolvedValueOnce([])

		expect(await repository.findThread({ threadId })).toBeUndefined()
	})

	test('reads back only the published comment after an edit', async () => {
		returningMock.mockResolvedValueOnce([{ id: commentId }])
		limitMock.mockResolvedValueOnce([comment])

		expect(
			await repository.editComment({
				commentId,
				body: 'Edited',
				editedAt: createdAt,
			})
		).toEqual(comment)
		expect(whereMock).toHaveBeenNthCalledWith(
			2,
			and(
				eq(pullRequestComments.id, commentId),
				eq(pullRequestComments.state, 'published')
			)
		)
	})

	test('locks the thread row before deleting its last comment', async () => {
		limitMock.mockResolvedValue([])

		expect(await repository.deleteComment({ commentId, threadId })).toBeTruthy()
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(selectMock).toHaveBeenNthCalledWith(1, { id: pullRequestThreads.id })
		expect(whereMock).toHaveBeenNthCalledWith(
			1,
			eq(pullRequestThreads.id, threadId)
		)
		expect(forMock).toHaveBeenCalledWith('update')

		const [lockOrder = 0] = forMock.mock.invocationCallOrder
		const [deleteOrder = 0] = deleteMock.mock.invocationCallOrder
		expect(lockOrder).toBeLessThan(deleteOrder)
		expect(deleteMock).toHaveBeenNthCalledWith(1, pullRequestComments)
		expect(deleteMock).toHaveBeenNthCalledWith(2, pullRequestThreads)
	})

	test('keeps the thread when another comment remains', async () => {
		limitMock.mockResolvedValue([{ id: commentId }])

		expect(await repository.deleteComment({ commentId, threadId })).toBeFalsy()
		expect(deleteMock).toHaveBeenCalledOnce()
	})
})
