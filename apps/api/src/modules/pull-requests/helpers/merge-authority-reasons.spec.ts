import { toMergeAuthorityReasons } from './merge-authority-reasons'

describe('toMergeAuthorityReasons', () => {
	test('says nothing against a writer on a repository Tessera owns', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: true,
				viewerRole: 'write',
			})
		).toEqual([])
	})

	test('refuses a repository whose merges happen on GitHub', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: false,
				viewerRole: 'write',
			})
		).toEqual([{ code: 'read_only_mirror', authority: 'github' }])
	})

	test('refuses a viewer below write access', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: true,
				viewerRole: 'read',
			})
		).toEqual([
			{
				code: 'insufficient_permission',
				requiredRole: 'write',
				actualRole: 'read',
			},
		])
	})

	// Nobody is not a role, and the reason has to say so rather than claim a role
	// the caller does not hold.
	test('refuses a viewer with no role at all', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: true,
				viewerRole: undefined,
			})
		).toEqual([
			{
				code: 'insufficient_permission',
				requiredRole: 'write',
				actualRole: undefined,
			},
		])
	})

	test('admits roles above write', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: true,
				viewerRole: 'admin',
			})
		).toEqual([])
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: true,
				viewerRole: 'owner',
			})
		).toEqual([])
	})

	// Both are facts about the repository and the viewer, and one does not excuse
	// the other, so a caller failing both is told both.
	test('reports both refusals together', () => {
		expect(
			toMergeAuthorityReasons({
				tesseraWritesAllowed: false,
				viewerRole: 'read',
			})
		).toEqual([
			{ code: 'read_only_mirror', authority: 'github' },
			{
				code: 'insufficient_permission',
				requiredRole: 'write',
				actualRole: 'read',
			},
		])
	})
})
