import { Injectable } from '@nestjs/common'
import type {
	CheckState,
	RequiredContext,
	RequiredContextEvaluation,
} from '@repo/contracts'
import type { RepositoryId } from '@repo/domain'
import {
	isFailingCheckState,
	isPendingCheckState,
	isSatisfyingCheckState,
} from '../domain/check-state'
import { toCheckOutput } from '../helpers/check-output'
import { matchesRequiredContext } from '../helpers/required-context'
import {
	ChecksRepository,
	type EffectiveCheckRow,
} from '../infrastructure/checks.repository'

export type ChecksEvaluationState = 'success' | 'pending' | 'failure'

export interface ChecksEvaluation {
	headSha: string
	perContext: RequiredContextEvaluation[]
	/** Requirements still waiting on a result. */
	pending: RequiredContextEvaluation[]
	/**
	 * Requirements no result can still satisfy. A requirement nothing ever
	 * reported on belongs here: an absent check is a failure to meet it, not a
	 * check that has yet to run.
	 */
	failing: RequiredContextEvaluation[]
	overall: ChecksEvaluationState
}

/**
 * Turns imported results into a verdict against a set of requirements.
 *
 * Deliberately config-agnostic: it is told what is required and answers whether
 * the commit meets it. Where requirements come from, and whether a verdict is
 * allowed to block anything, belong to the caller — TES-59 — not here.
 */
@Injectable()
export class ChecksEvaluationService {
	constructor(private readonly checksRepository: ChecksRepository) {}

	async evaluate(
		repositoryId: RepositoryId,
		headSha: string,
		requiredContexts: RequiredContext[]
	): Promise<ChecksEvaluation> {
		const requirements = toDistinctRequirements(requiredContexts)

		// No requirements is not a passing grade for anything, it is an empty exam.
		// The advisory read rollup reports `none` for the same commit.
		if (requirements.length === 0)
			return {
				headSha,
				perContext: [],
				pending: [],
				failing: [],
				overall: 'success',
			}

		const rows = await this.checksRepository.listEffectiveChecks({
			repositoryId,
			shas: [headSha],
		})
		const perContext = requirements.map(requirement =>
			toRequirementResult(requirement, rows)
		)
		const unmet = perContext.filter(result => !result.satisfied)

		return {
			headSha,
			perContext,
			pending: unmet.filter(isPendingRequirement),
			failing: unmet.filter(result => !isPendingRequirement(result)),
			overall: toOverallState(perContext),
		}
	}
}

function isPendingRequirement({ state }: RequiredContextEvaluation): boolean {
	return state !== 'missing' && isPendingCheckState(state)
}

function toRequirementResult(
	requirement: RequiredContext,
	rows: EffectiveCheckRow[]
): RequiredContextEvaluation {
	const matches = rows.filter(row => matchesRequiredContext(requirement, row))
	// An unqualified requirement can match a commit status and a check run of the
	// same name at once. The worst of them decides: a requirement is met only when
	// everything answering to its name met it.
	const [row] = matches.sort(
		(left, right) => toStateSeverity(left.state) - toStateSeverity(right.state)
	)

	if (!row) return { requirement, state: 'missing', satisfied: false }

	return {
		requirement,
		state: row.state,
		satisfied: isSatisfyingCheckState(row.state),
		check: toCheckOutput(row),
	}
}

/** Failure dominates pending, pending dominates success. A missing check fails. */
function toOverallState(
	results: RequiredContextEvaluation[]
): ChecksEvaluationState {
	let overall: ChecksEvaluationState = 'success'

	for (const result of results) {
		if (result.satisfied) continue

		if (isPendingRequirement(result)) overall = 'pending'
		else return 'failure'
	}

	return overall
}

function toStateSeverity(state: CheckState): number {
	if (isFailingCheckState(state)) return 0

	return isPendingCheckState(state) ? 1 : 2
}

function toDistinctRequirements(
	requiredContexts: RequiredContext[]
): RequiredContext[] {
	const requirements = new Map(
		requiredContexts.map(requirement => [
			toRequirementKey(requirement),
			requirement,
		])
	)

	return [...requirements]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, requirement]) => requirement)
}

function toRequirementKey({
	context,
	kind,
	providerAppId,
}: RequiredContext): string {
	return [context, kind ?? '', providerAppId ?? ''].join('\0')
}
