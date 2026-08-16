import {
	decideGitHubLoginClaim,
	isGitHubLoginCandidate,
} from './github-login-claim'

describe(decideGitHubLoginClaim.name, () => {
	test('allows a login GitHub does not have', () => {
		expect(decideGitHubLoginClaim({ exists: false }, null)).toBe('available')
	})

	test('allows an existing login claimed by the linked account', () => {
		expect(
			decideGitHubLoginClaim(
				{ exists: true, id: 42, login: 'TesseraHQ', type: 'Organization' },
				42
			)
		).toBe('available')
	})

	test('rejects an existing unclaimed login', () => {
		expect(
			decideGitHubLoginClaim(
				{ exists: true, id: 42, login: 'tessera', type: 'User' },
				43
			)
		).toBe('conflict')
		expect(
			decideGitHubLoginClaim(
				{ exists: true, id: 42, login: 'tessera', type: 'User' },
				null
			)
		).toBe('conflict')
	})
})

describe(isGitHubLoginCandidate.name, () => {
	test.each([
		'tessera',
		'tessera-hq',
		'a'.repeat(39),
	])('accepts %s as a GitHub login candidate', handle => {
		expect(isGitHubLoginCandidate(handle)).toBe(true)
	})

	test.each([
		'-tessera',
		'tessera-',
		'tessera--hq',
		'a'.repeat(40),
	])('rejects %s as a GitHub login candidate', handle => {
		expect(isGitHubLoginCandidate(handle)).toBe(false)
	})
})
