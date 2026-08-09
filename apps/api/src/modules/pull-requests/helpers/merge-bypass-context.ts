import type {
	MergeRequirements,
	ParsedMergePullRequestInput,
} from '@repo/contracts'
import type { PullRequestMergeBypass } from '@repo/db'

/**
 * What a bypass is recorded as, or nothing when the attempt is not one. A bypass
 * is refused unless the evaluation itself offered it: the role, the rule and the
 * blockers all have to allow it, and that decision belongs to the evaluation
 * rather than to whoever sent the request.
 */
export function toMergeBypassContext(
	requirements: MergeRequirements,
	bypass: ParsedMergePullRequestInput['bypass']
): PullRequestMergeBypass | undefined {
	if (requirements.eligible) return undefined
	if (!(bypass && requirements.canBypass)) return undefined
	if (!(requirements.evaluatedBaseSha && requirements.evaluatedHeadSha))
		return undefined

	return {
		ruleId: requirements.rule?.id,
		ruleVersion: requirements.rule?.version,
		reason: bypass.reason,
		bypassedReasonCodes: requirements.reasons.map(reason => reason.code),
		baseSha: requirements.evaluatedBaseSha,
		headSha: requirements.evaluatedHeadSha,
	}
}
