import type { PullRequestComment, PullRequestThread } from '@repo/contracts'
import {
	canDeletePullRequestComment,
	canEditPullRequestComment,
	canReplyToPullRequestThread,
	canResolvePullRequestThread,
	getPullRequestThreadPermissions,
} from './pull-request-thread-permissions'

type PullRequestCommentAuthorId = NonNullable<
	PullRequestComment['author']['userId']
>

const VIEWER_ID =
	'00000000-0000-4000-8000-000000000001' as PullRequestCommentAuthorId
const OTHER_ID =
	'00000000-0000-4000-8000-000000000002' as PullRequestCommentAuthorId

function author(
	userId: PullRequestCommentAuthorId,
	username: string
): PullRequestComment['author'] {
	return { key: userId, provider: 'tessera', userId, username }
}

const COMMENT = {
	id: '00000000-0000-4000-8000-000000000003' as PullRequestComment['id'],
	threadId:
		'00000000-0000-4000-8000-000000000004' as PullRequestComment['threadId'],
	author: author(VIEWER_ID, 'marta'),
	body: 'Review',
	state: 'published',
	createdAt: new Date('2026-08-06T10:00:00Z'),
} as PullRequestComment
const THREAD = {
	id: COMMENT.threadId,
	kind: 'top_level',
	outdated: false,
	createdAt: COMMENT.createdAt,
	comments: [COMMENT],
} as PullRequestThread
const INLINE_THREAD = { ...THREAD, kind: 'inline' } as PullRequestThread

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

		expect(canResolvePullRequestThread(participant, THREAD)).toBeTruthy()
		expect(canEditPullRequestComment(participant, COMMENT)).toBeTruthy()
		expect(canDeletePullRequestComment(participant, COMMENT)).toBeTruthy()
		expect(canResolvePullRequestThread(stranger, THREAD)).toBeFalsy()
		expect(canEditPullRequestComment(stranger, COMMENT)).toBeFalsy()
		expect(canDeletePullRequestComment(stranger, COMMENT)).toBeFalsy()
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

		expect(canResolvePullRequestThread(administrator, THREAD)).toBeTruthy()
		expect(canDeletePullRequestComment(administrator, COMMENT)).toBeTruthy()
		expect(canEditPullRequestComment(administrator, COMMENT)).toBeFalsy()
	})

	test('offers no resolution on a thread holding only pending draft comments', () => {
		const author = getPullRequestThreadPermissions({
			viewer: {
				canComment: true,
				canResolveAnyThread: true,
				canDeleteAnyComment: true,
			},
			viewerUserId: VIEWER_ID,
		})
		const draftComment = { ...COMMENT, state: 'pending' } as PullRequestComment
		const draftThread = {
			...THREAD,
			comments: [draftComment],
		} as PullRequestThread

		expect(canResolvePullRequestThread(author, draftThread)).toBeFalsy()
		expect(canEditPullRequestComment(author, draftComment)).toBeTruthy()
	})

	test.each([
		['mirrored top-level', true, THREAD, false],
		['mirrored inline', true, INLINE_THREAD, true],
		['native top-level', false, THREAD, true],
	] as const)('offers reply and resolve correctly for a %s thread', (_name, isGitHubAuthoritative, thread, expected) => {
		const permissions = getPullRequestThreadPermissions({
			viewer: {
				canComment: true,
				canResolveAnyThread: true,
				canDeleteAnyComment: true,
			},
			viewerUserId: VIEWER_ID,
			isGitHubAuthoritative,
		})

		expect(canReplyToPullRequestThread(permissions, thread)).toBe(expected)
		expect(canResolvePullRequestThread(permissions, thread)).toBe(expected)
	})
})
