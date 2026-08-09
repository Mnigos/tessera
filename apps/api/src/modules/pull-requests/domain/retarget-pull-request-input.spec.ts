import {
	pullRequestEventSchema,
	retargetPullRequestInputSchema,
} from '@repo/contracts'

const input = { username: 'marta', slug: 'notes', number: 1 }
const event = {
	id: '00000000-0000-4000-8000-000000000045',
	pullRequestId: '00000000-0000-4000-8000-000000000044',
	provider: 'tessera' as const,
	actorUsername: 'marta',
	type: 'retargeted' as const,
	createdAt: '2026-08-08T10:00:00.000Z',
}

describe('retarget pull request input', () => {
	test('trims the requested target branch', () => {
		expect(
			retargetPullRequestInputSchema.parse({
				...input,
				targetBranch: '  release  ',
			}).targetBranch
		).toBe('release')
	})

	test.each([
		['an empty branch', ''],
		['a whitespace-only branch', '   '],
		['an oversized branch', 'r'.repeat(256)],
	])('rejects %s', (_name, targetBranch) => {
		expect(
			retargetPullRequestInputSchema.safeParse({ ...input, targetBranch })
				.success
		).toBeFalsy()
	})

	// Retargeting is target-only. A caller that sends a source branch does not get
	// one applied by accident — the field is simply not part of the input.
	test('carries no source branch through', () => {
		expect(
			retargetPullRequestInputSchema.parse({
				...input,
				targetBranch: 'release',
				sourceBranch: 'other',
			})
		).not.toHaveProperty('sourceBranch')
	})
})

// The payload union carries no discriminator and the first member that parses
// wins, so a shape whose fields another member also accepts would be silently
// stripped on the way out.
describe('retargeted event payload', () => {
	test('keeps both branches through the timeline schema', () => {
		expect(
			pullRequestEventSchema.parse({
				...event,
				payload: { fromBranch: 'main', toBranch: 'release' },
			}).payload
		).toEqual({ fromBranch: 'main', toBranch: 'release' })
	})

	// Provider-synchronized retargets carry nothing, and the timeline falls back
	// to its generic label for them.
	test('accepts a retargeted event with no payload at all', () => {
		expect(pullRequestEventSchema.parse(event).payload).toBeUndefined()
	})
})
