import {
	joinMergeQueueInputSchema,
	mergePullRequestInputSchema,
} from '@repo/contracts'

const NUL = String.fromCharCode(0)
const mergeInput = {
	username: 'marta',
	slug: 'notes',
	number: 1,
	expectedBaseSha: 'a'.repeat(40),
	expectedHeadSha: 'b'.repeat(40),
}
const joinInput = { username: 'marta', slug: 'notes', number: 1 }

describe('merge strategy inputs', () => {
	test.each([
		'merge_commit',
		'squash',
		'rebase',
		'fast_forward',
	] as const)('accepts %s', strategy => {
		expect(
			mergePullRequestInputSchema.safeParse({ ...mergeInput, strategy }).success
		).toBeTruthy()
		expect(
			joinMergeQueueInputSchema.safeParse({ ...joinInput, strategy }).success
		).toBeTruthy()
	})

	// The method is an explicit choice. Defaulting it would merge one way while
	// the caller believed another, which is the one mistake no audit row fixes.
	test('requires a method', () => {
		expect(
			mergePullRequestInputSchema.safeParse(mergeInput).success
		).toBeFalsy()
		expect(joinMergeQueueInputSchema.safeParse(joinInput).success).toBeFalsy()
	})

	// Refused rather than quietly dropped: a caller that sent a title it believed
	// would be used has misunderstood something worth being told about.
	test.each([
		'merge_commit',
		'rebase',
		'fast_forward',
	] as const)('refuses a squash message on %s, which writes none', strategy => {
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy,
				squashTitle: 'Ignored',
			}).success
		).toBeFalsy()
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy,
				squashBody: 'Ignored',
			}).success
		).toBeFalsy()
		expect(
			joinMergeQueueInputSchema.safeParse({
				...joinInput,
				strategy,
				squashTitle: 'Ignored',
			}).success
		).toBeFalsy()
	})

	test('accepts a squash message on squash', () => {
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy: 'squash',
				squashTitle: 'Everything at once (#1)',
				squashBody: 'Why it changed',
			}).success
		).toBeTruthy()
	})

	// A schema that trims and a schema that checks for NUL cannot be intersected:
	// zod runs both against the untouched input and then demands the results
	// match, so a trimmed value and an untrimmed one throw out of `safeParse`
	// entirely. Pasted titles carry whitespace far more often than they carry NUL.
	test('accepts a padded title and trims it', () => {
		const parsed = mergePullRequestInputSchema.safeParse({
			...mergeInput,
			strategy: 'squash',
			squashTitle: '  Add search  ',
		})

		expect(parsed.success).toBeTruthy()
		expect(parsed.success && parsed.data.squashTitle).toBe('Add search')
	})

	test('accepts a padded squash body', () => {
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy: 'squash',
				squashBody: '  Why it changed  ',
			}).success
		).toBeTruthy()
	})

	// Git storage refuses both, and it would refuse them as invalid input —
	// reaching the reader as a merge that mysteriously will not go through.
	test('refuses text a commit message cannot carry', () => {
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy: 'squash',
				squashTitle: `Add${NUL}search`,
			}).success
		).toBeFalsy()
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy: 'squash',
				squashBody: `Why${NUL}it changed`,
			}).success
		).toBeFalsy()
		expect(
			mergePullRequestInputSchema.safeParse({
				...mergeInput,
				strategy: 'squash',
				squashTitle: 'Add search\nand more',
			}).success
		).toBeFalsy()
	})
})
