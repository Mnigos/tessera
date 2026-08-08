import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNull,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	sql,
} from '@repo/db'
import type {
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	UserId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestReviewsRepository } from './pull-request-reviews.repository'

const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const reviewerUserId = '00000000-0000-4000-8000-000000000055' as UserId
const reviewId = '00000000-0000-4000-8000-000000000066' as PullRequestReviewId
const threadId = '00000000-0000-4000-8000-000000000077' as PullRequestThreadId
const requestId =
	'00000000-0000-4000-8000-000000000088' as PullRequestReviewerRequestId
const submittedAt = new Date('2026-08-08T10:00:00Z')
const submittedReview = {
	id: reviewId,
	reviewerUserId,
	reviewerUsername: 'reviewer',
	outcome: 'request_changes' as const,
	body: 'Please revise',
	headSha: 'reviewed-head',
	submittedAt,
}
const reviewerRequest = {
	id: requestId,
	reviewerUserId,
	reviewerUsername: 'reviewer',
	requestedByUserId: mockUserId,
	requestedByUsername: 'marta',
	createdAt: submittedAt,
}

describe(PullRequestReviewsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestReviewsRepository

	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const selectDistinctOnMock = vi.fn()
	const fromMock = vi.fn()
	const leftJoinMock = vi.fn()
	const innerJoinMock = vi.fn()
	const whereMock = vi.fn()
	const orderByMock = vi.fn()
	const groupByMock = vi.fn()
	const limitMock = vi.fn()
	const forMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const onConflictDoNothingMock = vi.fn()
	const returningMock = vi.fn()
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()

	/**
	 * Drizzle query builders are thenable, so an ordered read can be awaited on
	 * the spot or carry on into a limit or a row lock.
	 */
	function orderedQuery(rows: unknown[] = []) {
		return Object.assign(Promise.resolve(rows), {
			limit: limitMock,
			for: forMock,
		})
	}

	beforeEach(async () => {
		vi.resetAllMocks()
		orderByMock.mockReturnValue(orderedQuery())
		groupByMock.mockResolvedValue([])
		limitMock.mockResolvedValue([])
		forMock.mockResolvedValue([])
		returningMock.mockResolvedValue([])
		deleteWhereMock.mockResolvedValue(undefined)
		whereMock.mockReturnValue({
			orderBy: orderByMock,
			groupBy: groupByMock,
			limit: limitMock,
			for: forMock,
			returning: returningMock,
		})
		const joinedQuery = {
			leftJoin: leftJoinMock,
			innerJoin: innerJoinMock,
			where: whereMock,
		}
		leftJoinMock.mockReturnValue(joinedQuery)
		innerJoinMock.mockReturnValue(joinedQuery)
		fromMock.mockReturnValue(joinedQuery)
		selectMock.mockReturnValue({ from: fromMock })
		selectDistinctOnMock.mockReturnValue({ from: fromMock })
		onConflictDoNothingMock.mockReturnValue({ returning: returningMock })
		valuesMock.mockReturnValue({
			onConflictDoNothing: onConflictDoNothingMock,
			returning: returningMock,
		})
		insertMock.mockReturnValue({ values: valuesMock })
		setMock.mockReturnValue({ where: whereMock })
		updateMock.mockReturnValue({ set: setMock })
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		const tx = {
			select: selectMock,
			selectDistinctOn: selectDistinctOnMock,
			insert: insertMock,
			update: updateMock,
			delete: deleteMock,
		}
		transactionMock.mockImplementation(callback => callback(tx))

		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestReviewsRepository,
				{
					provide: Database,
					useValue: { ...tx, transaction: transactionMock },
				},
			],
		}).compile()
		repository = moduleRef.get(PullRequestReviewsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('submits, publishes, fulfils, and emits review_submitted in one transaction', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		limitMock.mockResolvedValueOnce([submittedReview])
		returningMock.mockResolvedValueOnce([{ id: reviewId }])

		expect(
			await repository.submitReview({
				pullRequestId,
				reviewerUserId,
				pendingReviewId: reviewId,
				outcome: 'request_changes',
				body: 'Please revise',
				headSha: 'reviewed-head',
				submittedAt,
			})
		).toEqual({ status: 'submitted', review: submittedReview })

		expect(transactionMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenNthCalledWith(1, pullRequestReviews)
		expect(setMock).toHaveBeenNthCalledWith(1, {
			state: 'submitted',
			outcome: 'request_changes',
			body: 'Please revise',
			headSha: 'reviewed-head',
			submittedAt,
		})
		expect(whereMock).toHaveBeenNthCalledWith(
			2,
			and(
				eq(pullRequestReviews.id, reviewId),
				eq(pullRequestReviews.state, 'pending')
			)
		)
		expect(updateMock).toHaveBeenNthCalledWith(2, pullRequestComments)
		expect(setMock).toHaveBeenNthCalledWith(2, { state: 'published' })
		expect(whereMock).toHaveBeenNthCalledWith(
			3,
			and(
				eq(pullRequestComments.reviewId, reviewId),
				eq(pullRequestComments.state, 'pending')
			)
		)
		expect(updateMock).toHaveBeenNthCalledWith(3, pullRequestReviewerRequests)
		expect(setMock).toHaveBeenNthCalledWith(3, {
			fulfilledByReviewId: reviewId,
		})
		expect(whereMock).toHaveBeenNthCalledWith(
			4,
			and(
				eq(pullRequestReviewerRequests.pullRequestId, pullRequestId),
				eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
				isNull(pullRequestReviewerRequests.removedAt),
				isNull(pullRequestReviewerRequests.fulfilledByReviewId)
			)
		)
		expect(insertMock).toHaveBeenCalledWith(pullRequestEvents)
		expect(valuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: reviewerUserId,
			type: 'review_submitted',
			payload: {
				reviewId,
				outcome: 'request_changes',
				headSha: 'reviewed-head',
			},
		})
	})

	test('conflicts instead of opening a second review when the envelope was already sealed', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		returningMock.mockResolvedValueOnce([])

		expect(
			await repository.submitReview({
				pullRequestId,
				reviewerUserId,
				pendingReviewId: reviewId,
				outcome: 'approve',
				body: '',
				headSha: 'reviewed-head',
				submittedAt,
			})
		).toEqual({ status: 'pending_review_conflict' })
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('opens the review inside the locked transaction for a direct submission', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		returningMock.mockResolvedValueOnce([{ id: reviewId }])
		limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([submittedReview])

		await repository.submitReview({
			pullRequestId,
			reviewerUserId,
			outcome: 'approve',
			body: '',
			headSha: 'reviewed-head',
			submittedAt,
		})

		expect(insertMock).toHaveBeenNthCalledWith(1, pullRequestReviews)
		expect(valuesMock).toHaveBeenNthCalledWith(1, {
			pullRequestId,
			reviewerUserId,
			state: 'submitted',
			outcome: 'approve',
			body: '',
			headSha: 'reviewed-head',
			submittedAt,
		})
		expect(updateMock).not.toHaveBeenCalledWith(pullRequestReviews)
	})

	test('answers a repeated direct submission with the review it already stored', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		limitMock.mockResolvedValueOnce([submittedReview])

		expect(
			await repository.submitReview({
				pullRequestId,
				reviewerUserId,
				outcome: submittedReview.outcome,
				body: submittedReview.body,
				headSha: submittedReview.headSha,
				submittedAt: new Date('2026-08-08T10:05:00Z'),
			})
		).toEqual({ status: 'submitted', review: submittedReview })
		expect(insertMock).not.toHaveBeenCalled()
		expect(updateMock).not.toHaveBeenCalled()
	})

	test.each([
		{ change: 'outcome', submission: { outcome: 'approve' as const } },
		{ change: 'body', submission: { body: 'Actually, ship it' } },
		{ change: 'head', submission: { headSha: 'later-head' } },
	])('supersedes the stored review when the $change differs', async ({
		submission,
	}) => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		limitMock
			.mockResolvedValueOnce([submittedReview])
			.mockResolvedValueOnce([submittedReview])
		returningMock.mockResolvedValueOnce([{ id: reviewId }])

		await repository.submitReview({
			pullRequestId,
			reviewerUserId,
			outcome: submittedReview.outcome,
			body: submittedReview.body,
			headSha: submittedReview.headSha,
			submittedAt,
			...submission,
		})

		expect(insertMock).toHaveBeenNthCalledWith(1, pullRequestReviews)
	})

	test('never treats a sealed envelope as a repeated submission', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		returningMock.mockResolvedValueOnce([{ id: reviewId }])
		limitMock.mockResolvedValueOnce([submittedReview])

		expect(
			await repository.submitReview({
				pullRequestId,
				reviewerUserId,
				pendingReviewId: reviewId,
				outcome: submittedReview.outcome,
				body: submittedReview.body,
				headSha: submittedReview.headSha,
				submittedAt,
			})
		).toEqual({ status: 'submitted', review: submittedReview })
		expect(updateMock).toHaveBeenNthCalledWith(1, pullRequestReviews)
	})

	test('refuses to submit against a pull request that is no longer open', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'merged' }])

		expect(
			await repository.submitReview({
				pullRequestId,
				reviewerUserId,
				pendingReviewId: reviewId,
				outcome: 'approve',
				body: '',
				headSha: 'reviewed-head',
				submittedAt,
			})
		).toEqual({ status: 'pull_request_closed' })
		expect(updateMock).not.toHaveBeenCalled()
	})

	test('reuses one pending review per reviewer and preserves its stored head', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		limitMock.mockResolvedValueOnce([{ id: reviewId }])

		expect(
			await repository.getOrCreatePendingReview({
				pullRequestId,
				reviewerUserId,
				headSha: 'newer-client-head',
			})
		).toBe(reviewId)
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('handles concurrent pending-review uniqueness by reading the winner', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		limitMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ id: reviewId }])
		returningMock.mockResolvedValueOnce([])

		expect(
			await repository.getOrCreatePendingReview({
				pullRequestId,
				reviewerUserId,
				headSha: 'head',
			})
		).toBe(reviewId)
		expect(onConflictDoNothingMock).toHaveBeenCalledOnce()
	})

	test.each([
		{
			action: 'getOrCreatePendingReview' as const,
			expected: undefined,
		},
		{ action: 'discardPendingReview' as const, expected: false },
	])('stops $action once the pull request is no longer open', async ({
		action,
		expected,
	}) => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'closed' }])

		const result =
			action === 'getOrCreatePendingReview'
				? await repository.getOrCreatePendingReview({
						pullRequestId,
						reviewerUserId,
						headSha: 'head',
					})
				: await repository.discardPendingReview({
						pullRequestId,
						reviewerUserId,
					})

		expect(result).toBe(expected)
		expect(insertMock).not.toHaveBeenCalled()
		expect(deleteMock).not.toHaveBeenCalled()
	})

	test('maps active-request uniqueness to an already-requested reviewer', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		returningMock.mockResolvedValueOnce([])

		expect(
			await repository.createReviewerRequest({
				pullRequestId,
				reviewerUserId,
				requestedByUserId: mockUserId,
				reviewerUsername: 'reviewer',
			})
		).toEqual({ status: 'already_requested' })
		expect(onConflictDoNothingMock).toHaveBeenCalledOnce()
		expect(insertMock).not.toHaveBeenCalledWith(pullRequestEvents)
	})

	test('refuses to request a reviewer once the pull request is no longer open', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'merged' }])

		expect(
			await repository.createReviewerRequest({
				pullRequestId,
				reviewerUserId,
				requestedByUserId: mockUserId,
				reviewerUsername: 'reviewer',
			})
		).toEqual({ status: 'pull_request_closed' })
		expect(insertMock).not.toHaveBeenCalled()
	})

	/**
	 * The partial unique only covers requests that are neither removed nor
	 * fulfilled, so a reviewer whose earlier request was removed inserts cleanly.
	 */
	test('re-requests a reviewer whose earlier request was removed or fulfilled', async () => {
		forMock.mockResolvedValueOnce([{ id: pullRequestId, state: 'open' }])
		returningMock.mockResolvedValueOnce([{ id: requestId }])
		limitMock.mockResolvedValueOnce([reviewerRequest])

		expect(
			await repository.createReviewerRequest({
				pullRequestId,
				reviewerUserId,
				requestedByUserId: mockUserId,
				reviewerUsername: 'reviewer',
			})
		).toEqual({ status: 'created', request: reviewerRequest })
		expect(insertMock).toHaveBeenNthCalledWith(1, pullRequestReviewerRequests)
		expect(insertMock).toHaveBeenNthCalledWith(2, pullRequestEvents)
		expect(valuesMock).toHaveBeenNthCalledWith(2, {
			pullRequestId,
			actorUserId: mockUserId,
			type: 'review_requested',
			payload: { reviewerUserId, reviewerUsername: 'reviewer' },
		})
	})

	/**
	 * Walks the discard through its locks: the pull request, the pending review,
	 * the threads its drafts live in, and finally whatever comments are left.
	 */
	function mockDiscardReads({
		draftThreadIds = [threadId],
		remainingCommentThreadIds = [] as PullRequestThreadId[],
	} = {}) {
		const lockThreadsMock = vi
			.fn()
			.mockResolvedValue(draftThreadIds.map(id => ({ id })))

		whereMock
			.mockReturnValueOnce({
				for: vi.fn().mockResolvedValue([{ id: pullRequestId, state: 'open' }]),
			})
			.mockReturnValueOnce({
				limit: vi.fn().mockReturnValue({
					for: vi.fn().mockResolvedValue([{ id: reviewId }]),
				}),
			})
			.mockResolvedValueOnce(draftThreadIds.map(id => ({ threadId: id })))
			.mockReturnValueOnce({ orderBy: orderByMock })
			.mockResolvedValueOnce(
				remainingCommentThreadIds.map(id => ({ threadId: id }))
			)
		orderByMock.mockReturnValueOnce({ for: lockThreadsMock })

		return { lockThreadsMock }
	}

	test('discards pending comments, empty threads, and the pending review', async () => {
		mockDiscardReads()

		expect(
			await repository.discardPendingReview({
				pullRequestId,
				reviewerUserId,
			})
		).toBeTruthy()
		expect(deleteMock).toHaveBeenNthCalledWith(1, pullRequestComments)
		expect(deleteMock).toHaveBeenNthCalledWith(2, pullRequestThreads)
		expect(deleteMock).toHaveBeenNthCalledWith(3, pullRequestReviews)
	})

	test('takes the thread locks in id order before deleting any draft comment', async () => {
		const { lockThreadsMock } = mockDiscardReads()

		await repository.discardPendingReview({ pullRequestId, reviewerUserId })

		expect(orderByMock).toHaveBeenCalledWith(asc(pullRequestThreads.id))
		expect(lockThreadsMock).toHaveBeenCalledWith('update')

		const [lockOrder = 0] = lockThreadsMock.mock.invocationCallOrder
		const [deleteOrder = 0] = deleteMock.mock.invocationCallOrder
		expect(lockOrder).toBeLessThan(deleteOrder)
	})

	test('keeps threads which still have comments while discarding the review', async () => {
		mockDiscardReads({ remainingCommentThreadIds: [threadId] })

		expect(
			await repository.discardPendingReview({
				pullRequestId,
				reviewerUserId,
			})
		).toBeTruthy()
		expect(deleteMock).not.toHaveBeenCalledWith(pullRequestThreads)
		expect(deleteMock).toHaveBeenCalledWith(pullRequestReviews)
	})

	test('uses one batched distinct-on review query and one batched request count query', async () => {
		orderByMock.mockResolvedValueOnce([])
		groupByMock.mockResolvedValueOnce([])

		await repository.listEffectiveReviews([pullRequestId])
		await repository.countActiveReviewerRequests([pullRequestId])

		expect(selectDistinctOnMock).toHaveBeenCalledOnce()
		expect(selectDistinctOnMock).toHaveBeenCalledWith(
			[pullRequestReviews.pullRequestId, pullRequestReviews.reviewerUserId],
			expect.any(Object)
		)
		expect(selectMock).toHaveBeenCalledOnce()
		expect(whereMock).toHaveBeenNthCalledWith(
			1,
			and(
				inArray(pullRequestReviews.pullRequestId, [pullRequestId]),
				eq(pullRequestReviews.state, 'submitted'),
				sql`${pullRequestReviews.reviewerUserId} is distinct from ${pullRequests.authorUserId}`
			)
		)
		expect(orderByMock).toHaveBeenCalledWith(
			pullRequestReviews.pullRequestId,
			pullRequestReviews.reviewerUserId,
			desc(pullRequestReviews.submittedAt),
			desc(pullRequestReviews.id)
		)
		expect(whereMock).toHaveBeenNthCalledWith(
			2,
			and(
				inArray(pullRequestReviewerRequests.pullRequestId, [pullRequestId]),
				isNull(pullRequestReviewerRequests.removedAt),
				isNull(pullRequestReviewerRequests.fulfilledByReviewId)
			)
		)
		expect(groupByMock).toHaveBeenCalledWith(
			pullRequestReviewerRequests.pullRequestId
		)
	})

	test('short-circuits empty review-summary batches', async () => {
		expect(await repository.listEffectiveReviews([])).toEqual([])
		expect(await repository.countActiveReviewerRequests([])).toEqual([])
		expect(selectMock).not.toHaveBeenCalled()
		expect(selectDistinctOnMock).not.toHaveBeenCalled()
	})
})
