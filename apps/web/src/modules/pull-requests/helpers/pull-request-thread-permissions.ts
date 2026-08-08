import type {
	PullRequestComment,
	PullRequestThread,
	PullRequestThreadViewer,
	SessionUser,
} from '@repo/contracts'
import type { PullRequestReviewContext } from './pull-request-review'

export interface PullRequestThreadPermissions extends PullRequestThreadViewer {
	viewerUserId?: SessionUser['id']
	review?: PullRequestReviewContext
}

export const READ_ONLY_PULL_REQUEST_THREAD_PERMISSIONS: PullRequestThreadPermissions =
	{
		canComment: false,
		canResolveAnyThread: false,
		canDeleteAnyComment: false,
	}

interface GetPullRequestThreadPermissionsInput {
	viewer?: PullRequestThreadViewer
	viewerUserId?: SessionUser['id']
	review?: PullRequestReviewContext
}

/**
 * Resolves which thread affordances the viewer may use. Authority and role
 * gates are decided by the server and echoed on the thread list; the viewer id
 * only decides the participant-based rules below.
 */
export function getPullRequestThreadPermissions({
	viewer,
	viewerUserId,
	review,
}: GetPullRequestThreadPermissionsInput): PullRequestThreadPermissions {
	if (!viewer) return READ_ONLY_PULL_REQUEST_THREAD_PERMISSIONS

	return { ...viewer, viewerUserId, review }
}

/**
 * Write collaborators may resolve any thread; everyone else may only resolve
 * threads they participate in. A thread the viewer only sees through their own
 * pending draft has nothing public to resolve, and the server refuses until the
 * review is submitted.
 */
export function canResolvePullRequestThread(
	permissions: PullRequestThreadPermissions,
	thread: PullRequestThread
) {
	if (!thread.comments.some(comment => comment.state === 'published'))
		return false

	return (
		permissions.canComment &&
		(permissions.canResolveAnyThread ||
			thread.comments.some(comment =>
				isPullRequestCommentAuthor(comment, permissions.viewerUserId)
			))
	)
}

/**
 * Only the author may edit a comment body.
 */
export function canEditPullRequestComment(
	permissions: PullRequestThreadPermissions,
	comment: PullRequestComment
) {
	return (
		permissions.canComment &&
		isPullRequestCommentAuthor(comment, permissions.viewerUserId)
	)
}

/**
 * The author may delete their own comment; administrators may delete any.
 */
export function canDeletePullRequestComment(
	permissions: PullRequestThreadPermissions,
	comment: PullRequestComment
) {
	return (
		permissions.canComment &&
		(isPullRequestCommentAuthor(comment, permissions.viewerUserId) ||
			permissions.canDeleteAnyComment)
	)
}

/**
 * A synchronized comment whose author has no Tessera account belongs to nobody
 * the viewer could be, so an absent identity on either side never matches.
 */
function isPullRequestCommentAuthor(
	comment: PullRequestComment,
	viewerUserId: SessionUser['id'] | undefined
) {
	return Boolean(viewerUserId) && comment.author.userId === viewerUserId
}
