import type {
	PullRequestComment,
	PullRequestThread,
	PullRequestThreadViewer,
	SessionUser,
} from '@repo/contracts'

export interface PullRequestThreadPermissions extends PullRequestThreadViewer {
	viewerUserId?: SessionUser['id']
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
}

/**
 * Resolves which thread affordances the viewer may use. Authority and role
 * gates are decided by the server and echoed on the thread list; the viewer id
 * only decides the participant-based rules below.
 */
export function getPullRequestThreadPermissions({
	viewer,
	viewerUserId,
}: GetPullRequestThreadPermissionsInput): PullRequestThreadPermissions {
	if (!viewer) return READ_ONLY_PULL_REQUEST_THREAD_PERMISSIONS

	return { ...viewer, viewerUserId }
}

/**
 * Write collaborators may resolve any thread; everyone else may only resolve
 * threads they participate in.
 */
export function canResolvePullRequestThread(
	permissions: PullRequestThreadPermissions,
	thread: PullRequestThread
) {
	return (
		permissions.canComment &&
		(permissions.canResolveAnyThread ||
			thread.comments.some(
				comment => comment.authorUserId === permissions.viewerUserId
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
		permissions.canComment && comment.authorUserId === permissions.viewerUserId
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
		(comment.authorUserId === permissions.viewerUserId ||
			permissions.canDeleteAnyComment)
	)
}
