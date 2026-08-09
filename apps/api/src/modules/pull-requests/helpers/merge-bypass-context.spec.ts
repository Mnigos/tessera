import type { MergeRequirements } from '@repo/contracts'
import type { BranchProtectionRuleId } from '@repo/domain'
import { toMergeBypassContext } from './merge-bypass-context'

const ruleId = '00000000-0000-4000-8000-000000000055' as BranchProtectionRuleId
const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)

const blockedRequirements: MergeRequirements = {
	eligible: false,
	canBypass: true,
	evaluatedBaseSha: baseSha,
	evaluatedHeadSha: headSha,
	rule: { id: ruleId, version: 3, targetBranch: 'main' },
	reasons: [
		{ code: 'approvals_required', required: 2, approved: 0, staleApprovals: 0 },
		{ code: 'threads_unresolved', count: 1 },
	],
}

describe('toMergeBypassContext', () => {
	test('records the rule, the refs and every blocker the bypass waives', () => {
		expect(
			toMergeBypassContext(blockedRequirements, {
				reason: 'Production incident',
			})
		).toEqual({
			ruleId,
			ruleVersion: 3,
			reason: 'Production incident',
			bypassedReasonCodes: ['approvals_required', 'threads_unresolved'],
			baseSha,
			headSha,
		})
	})

	test('is nothing when there was nothing to bypass', () => {
		expect(
			toMergeBypassContext(
				{ ...blockedRequirements, eligible: true, reasons: [] },
				{ reason: 'Production incident' }
			)
		).toBeUndefined()
	})

	test('is nothing when the caller asked for no bypass', () => {
		expect(toMergeBypassContext(blockedRequirements, undefined)).toBeUndefined()
	})

	// The affordance belongs to the evaluation: a request that asks for a bypass
	// the evaluation did not offer is an ordinary blocked attempt.
	test('refuses a bypass the evaluation did not offer', () => {
		expect(
			toMergeBypassContext(
				{ ...blockedRequirements, canBypass: false },
				{ reason: 'Ship it' }
			)
		).toBeUndefined()
	})

	// Without evaluated SHAs the audit could not say what was waived and against
	// which commits, so there is nothing worth recording.
	test('refuses a bypass that cannot name the refs it was judged against', () => {
		expect(
			toMergeBypassContext(
				{
					...blockedRequirements,
					evaluatedBaseSha: undefined,
					evaluatedHeadSha: undefined,
				},
				{ reason: 'Production incident' }
			)
		).toBeUndefined()
	})

	test('records a bypass on an unprotected branch without a rule', () => {
		expect(
			toMergeBypassContext(
				{ ...blockedRequirements, rule: undefined },
				{ reason: 'Production incident' }
			)
		).toMatchObject({ ruleId: undefined, ruleVersion: undefined })
	})
})
