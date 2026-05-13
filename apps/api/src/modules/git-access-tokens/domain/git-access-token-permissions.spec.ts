import {
	hasGitAccessTokenPermission,
	toBetterAuthGitAccessTokenPermissions,
} from './git-access-token-permissions'

describe('git access token permissions', () => {
	test('maps write permission requests to read and write Better Auth permissions', () => {
		expect(toBetterAuthGitAccessTokenPermissions(['git:write'])).toEqual({
			git: ['read', 'write'],
		})
	})

	test('maps read permission requests to read-only Better Auth permissions', () => {
		expect(toBetterAuthGitAccessTokenPermissions(['git:read'])).toEqual({
			git: ['read'],
		})
	})

	test('allows read access when read is granted', () => {
		expect(hasGitAccessTokenPermission({ git: ['read'] }, 'git:read')).toBe(
			true
		)
	})

	test('allows write access when write is granted', () => {
		expect(
			hasGitAccessTokenPermission({ git: ['read', 'write'] }, 'git:write')
		).toBe(true)
	})

	test('rejects write access when only read is granted', () => {
		expect(hasGitAccessTokenPermission({ git: ['read'] }, 'git:write')).toBe(
			false
		)
	})
})
