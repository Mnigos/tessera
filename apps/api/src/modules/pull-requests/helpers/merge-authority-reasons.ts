import type { MergeBlockingReason } from '@repo/contracts'
import { hasRepositoryRole, type RepositoryRole } from '@repo/domain'

/**
 * Whether the caller may merge in this repository at all, before anything about
 * this particular pull request is considered. Both answers are facts about the
 * repository and the viewer, so they cost nothing to establish and no policy can
 * waive either.
 */
export function toMergeAuthorityReasons({
	tesseraWritesAllowed,
	viewerRole,
}: {
	tesseraWritesAllowed: boolean
	viewerRole?: RepositoryRole
}): MergeBlockingReason[] {
	const reasons: MergeBlockingReason[] = []

	if (!tesseraWritesAllowed)
		reasons.push({ code: 'read_only_mirror', authority: 'github' })

	if (!hasRepositoryRole(viewerRole, 'write'))
		reasons.push({
			code: 'insufficient_permission',
			requiredRole: 'write',
			actualRole: viewerRole,
		})

	return reasons
}
