import { toPullRequestDisplayNumber } from './pull-request-display-number'

describe(toPullRequestDisplayNumber.name, () => {
	test('prefers the GitHub number for displayed text', () => {
		expect(
			toPullRequestDisplayNumber({
				number: 42,
				github: {
					nodeId: 'github-pull-request',
					htmlUrl: 'https://github.com/tessera/notes/pull/7',
					draft: false,
					headSha: 'a'.repeat(40),
					baseSha: 'b'.repeat(40),
					externalNumber: 7,
				},
			})
		).toBe(7)
	})

	test('falls back to the local route number', () => {
		expect(toPullRequestDisplayNumber({ number: 42 })).toBe(42)
	})
})
