import { Injectable } from '@nestjs/common'
import type {
	Check,
	ChecksList,
	ChecksSummary,
	RequiredContext,
} from '@repo/contracts'
import type { RepositoryId } from '@repo/domain'
import {
	isFailingCheckState,
	isPendingCheckState,
	toCheckRollupState,
	toCheckStateCounts,
} from '../domain/check-state'
import { toCheckOutput } from '../helpers/check-output'
import { matchesRequiredContext } from '../helpers/required-context'
import {
	ChecksRepository,
	type EffectiveCheckRow,
} from '../infrastructure/checks.repository'

/**
 * A commit to roll up, and whether it is still the head its pull request points
 * at. The commit is the identity; currency is context the reader needs to judge
 * how much the result is worth.
 */
export interface ChecksHead {
	sha: string
	isCurrent: boolean
}

/**
 * One caller's request for a rollup.
 *
 * The key belongs to the caller because currency does not belong to the commit:
 * two pull requests can point at the same commit and disagree about whether it
 * is still their head, and a rollup keyed by commit alone would let one of them
 * answer for the other.
 */
export interface ChecksHeadRef<TKey> extends ChecksHead {
	key: TKey
}

interface FindSummaryParams {
	head: ChecksHead
	repositoryId: RepositoryId
}

interface ListSummariesParams<TKey> {
	heads: ChecksHeadRef<TKey>[]
	repositoryId: RepositoryId
}

interface ListChecksParams extends FindSummaryParams {
	/** What the commit's target branch demands, for the caller that knows. */
	requiredContexts?: RequiredContext[]
}

@Injectable()
export class ChecksReadService {
	constructor(private readonly checksRepository: ChecksRepository) {}

	/**
	 * The rollup for one commit. Always answers: a commit nothing has reported on
	 * rolls up to `none` with every count at zero rather than going missing, so a
	 * caller never has to read an absent summary as either no results or an
	 * unasked question.
	 */
	async findSummary({
		head,
		repositoryId,
	}: FindSummaryParams): Promise<ChecksSummary> {
		const rows = await this.checksRepository.listEffectiveChecks({
			repositoryId,
			shas: [head.sha],
		})

		return toChecksSummary(head, rows)
	}

	/**
	 * Rollups for a page of commits in one query, keyed the way the caller asked
	 * for them. Every requested reference gets an answer, and each carries the
	 * currency of the reference that asked rather than of whichever caller
	 * happened to name the commit first.
	 */
	async listSummaries<TKey>({
		heads,
		repositoryId,
	}: ListSummariesParams<TKey>): Promise<Map<TKey, ChecksSummary>> {
		const shas = [...new Set(heads.map(head => head.sha))]
		const rows = await this.checksRepository.listEffectiveChecks({
			repositoryId,
			shas,
		})
		const rowsBySha = Map.groupBy(rows, row => row.sha)

		return new Map(
			heads.map(head => [
				head.key,
				toChecksSummary(head, rowsBySha.get(head.sha) ?? []),
			])
		)
	}

	/**
	 * Every effective check on one commit, worst outcome first, together with the
	 * requirements nothing reported on at all.
	 *
	 * A required context with no result is the most consequential thing the panel
	 * can say and the one thing a list of results structurally cannot contain, so
	 * the caller passes what it requires and gets the absences named. A caller
	 * with no policy to apply passes nothing and is told about nothing.
	 */
	async listChecks({
		head,
		repositoryId,
		requiredContexts = [],
	}: ListChecksParams): Promise<ChecksList> {
		const rows = await this.checksRepository.listEffectiveChecks({
			repositoryId,
			shas: [head.sha],
		})

		return {
			checks: rows.map(toCheckOutput).sort(compareChecks),
			missingRequiredContexts: requiredContexts.filter(
				requirement =>
					!rows.some(row => matchesRequiredContext(requirement, row))
			),
			headSha: head.sha,
			headIsCurrent: head.isCurrent,
			lastResultAt: toLastResultAt(rows),
		}
	}
}

function toChecksSummary(
	{ isCurrent, sha }: ChecksHead,
	rows: EffectiveCheckRow[]
): ChecksSummary {
	const states = rows.map(row => row.state)

	return {
		headSha: sha,
		overall: toCheckRollupState(states),
		counts: toCheckStateCounts(states),
		lastResultAt: toLastResultAt(rows),
		headIsCurrent: isCurrent,
	}
}

/** When Tessera last recorded a result for the commit, not when it last looked. */
function toLastResultAt(rows: EffectiveCheckRow[]): Date | undefined {
	let lastResultAt: Date | undefined

	for (const row of rows)
		if (!lastResultAt || row.observedAt > lastResultAt)
			lastResultAt = row.observedAt

	return lastResultAt
}

function compareChecks(left: Check, right: Check): number {
	const severity = toStateSeverity(left) - toStateSeverity(right)

	if (severity !== 0) return severity

	return (
		left.context.localeCompare(right.context) ||
		left.kind.localeCompare(right.kind)
	)
}

function toStateSeverity({ state }: Check): number {
	if (isFailingCheckState(state)) return 0

	return isPendingCheckState(state) ? 1 : 2
}
