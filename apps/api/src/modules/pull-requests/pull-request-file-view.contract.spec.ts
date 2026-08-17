import { setPullRequestFileViewedInputSchema } from '@repo/contracts'

const input = {
	username: 'marta',
	slug: 'notes',
	number: 1,
	expectedHeadSha: 'b'.repeat(40),
	viewed: true,
}

describe('pull request file view path contract', () => {
	test('preserves leading and trailing path spaces', () => {
		expect(
			setPullRequestFileViewedInputSchema.parse({
				...input,
				path: ' src/index.ts ',
			}).path
		).toBe(' src/index.ts ')
	})

	test('rejects null bytes', () => {
		expect(
			setPullRequestFileViewedInputSchema.safeParse({
				...input,
				path: 'src/\0index.ts',
			}).success
		).toBeFalsy()
	})

	test('measures the 2048-byte limit as UTF-8', () => {
		expect(
			setPullRequestFileViewedInputSchema.safeParse({
				...input,
				path: 'ą'.repeat(1024),
			}).success
		).toBeTruthy()
		expect(
			setPullRequestFileViewedInputSchema.safeParse({
				...input,
				path: 'ą'.repeat(1025),
			}).success
		).toBeFalsy()
	})
})
