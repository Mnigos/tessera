import type { PullRequestComment, PullRequestThread } from '@repo/contracts'
import {
	canDeletePullRequestComment,
	canEditPullRequestComment,
	canResolvePullRequestThread,
	getPullRequestThreadPermissions,
} from './pull-request-thread-permissions'

const VIEWER_ID =
	'00000000-0000-4000-8000-000000000001' as PullRequestComment['authorUserId']
const OTHER_ID =
	'00000000-0000-4000-8000-000000000002' as PullRequestComment['authorUserId']
const COMMENT = {
	id: '00000000-0000-4000-8000-000000000003',
	threadId: '00000000-0000-4000-8000-000000000004',
	authorUserId: VIEWER_ID,
	authorUsername: 'marta',
	body: 'Review',
	createdAt: new Date('2026-08-06T10:00:00Z'),
} as PullRequestComment
const THREAD = {
	id: COMMENT.threadId,
	kind: 'top_level',
	outdated: false,
	createdAt: COMMENT.createdAt,
	comments: [COMMENT],
} as PullRequestThread

describe('pull request thread permissions', () => {
	test('defaults to read-only without server authority', () => {
		expect(
			getPullRequestThreadPermissions({ viewerUserId: VIEWER_ID })
		).toEqual({
			canComment: false,
			canResolveAnyThread: false,
			canDeleteAnyComment: false,
		})
	})

	test('uses server gates and viewer identity for participant rules', () => {
		const participant = getPullRequestThreadPermissions({
			viewer: {
				canComment: true,
				canResolveAnyThread: false,
				canDeleteAnyComment: false,
			},
			viewerUserId: VIEWER_ID,
		})
		const stranger = { ...participant, viewerUserId: OTHER_ID }

		expect(canResolvePullRequestThread(participant, THREAD)).toBe(true)
		expect(canEditPullRequestComment(participant, COMMENT)).toBe(true)
		expect(canDeletePullRequestComment(participant, COMMENT)).toBe(true)
		expect(canResolvePullRequestThread(stranger, THREAD)).toBe(false)
		expect(canEditPullRequestComment(stranger, COMMENT)).toBe(false)
		expect(canDeletePullRequestComment(stranger, COMMENT)).toBe(false)
	})

	test('allows server-wide resolve and delete but never editing another author', () => {
		const administrator = getPullRequestThreadPermissions({
			viewer: {
				canComment: true,
				canResolveAnyThread: true,
				canDeleteAnyComment: true,
			},
			viewerUserId: OTHER_ID,
		})

		expect(canResolvePullRequestThread(administrator, THREAD)).toBe(true)
		expect(canDeletePullRequestComment(administrator, COMMENT)).toBe(true)
		expect(canEditPullRequestComment(administrator, COMMENT)).toBe(false)
	})
})
