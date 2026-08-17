import type { GitHubSyncReviewComment } from '../infrastructure/github-sync.client.types'
import {
	toGitHubDiffHunkExcerpt,
	toGitHubPullRequestAnchorCoordinates,
} from './github-pull-request-anchor'

const BASE_COMMENT: GitHubSyncReviewComment = {
	nodeId: 'comment-node',
	numericId: 1n,
	author: { nodeId: 'actor-node', numericId: 2n, login: 'marta', type: 'user' },
	body: 'Comment',
	htmlUrl: 'https://github.com/org/repo/pull/1#discussion_r1',
	subjectType: 'line',
	path: 'src/index.ts',
	createdAt: new Date('2026-08-08T10:00:00Z'),
	updatedAt: new Date('2026-08-08T10:00:00Z'),
}

describe(toGitHubPullRequestAnchorCoordinates.name, () => {
	test('pairs the current line with the current head', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					side: 'left',
					line: 8,
					originalLine: 3,
					originalCommitId: 'historical-head',
					diffHunk: '@@ -8 +8 @@\n-old value',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toEqual({
			path: 'src/index.ts',
			side: 'left',
			line: 8,
			lineExcerpt: 'old value',
			headSha: 'current-head',
			outdated: false,
		})
	})

	test('keeps a same-side provider range', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					side: 'right',
					line: 9,
					startSide: 'right',
					startLine: 7,
					diffHunk: '@@ -7,3 +7,3 @@\n first\n second\n third',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toMatchObject({ line: 9, startLine: 7 })
	})

	test('degrades a cross-side provider range to its end line', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					side: 'right',
					line: 9,
					startSide: 'left',
					startLine: 7,
					diffHunk: '@@ -7,3 +7,3 @@\n first\n second\n third',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toEqual({
			path: 'src/index.ts',
			side: 'right',
			line: 9,
			lineExcerpt: 'third',
			headSha: 'current-head',
			outdated: false,
		})
	})

	test('pairs the original line with the historical head', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					originalLine: 12,
					commitId: 'review-head',
					diffHunk: '@@ -11 +12 @@\n+new value',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toEqual({
			path: 'src/index.ts',
			side: 'right',
			line: 12,
			lineExcerpt: 'new value',
			headSha: 'review-head',
			outdated: true,
		})
	})

	test('takes the historical coordinates whole for an outdated thread', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					line: 40,
					originalLine: 12,
					commitId: 'current-head',
					originalCommitId: 'historical-head',
					diffHunk: '@@ -11 +12 @@\n+new value',
				},
				{ currentHeadSha: 'current-head', providerOutdated: true }
			)
		).toMatchObject({
			line: 12,
			headSha: 'historical-head',
			outdated: true,
		})
	})

	test('falls back to the historical set when the hunk cannot number the current line', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					line: 40,
					originalLine: 12,
					originalCommitId: 'historical-head',
					diffHunk: '@@ -11 +12 @@\n+new value',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toMatchObject({
			line: 12,
			lineExcerpt: 'new value',
			headSha: 'historical-head',
			outdated: true,
		})
	})

	test('skips a comment whose hunk numbers neither coordinate set', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					line: 40,
					originalLine: 41,
					originalCommitId: 'historical-head',
					diffHunk: '@@ -11 +12 @@\n+new value',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toBeUndefined()
	})

	test('skips a comment without a diff hunk rather than anchoring a blank excerpt', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{ ...BASE_COMMENT, line: 8, originalCommitId: 'historical-head' },
				{ currentHeadSha: 'current-head' }
			)
		).toBeUndefined()
	})

	test('skips historical coordinates with no historical head to pin them to', () => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{
					...BASE_COMMENT,
					originalLine: 12,
					diffHunk: '@@ -11 +12 @@\n+new value',
				},
				{ currentHeadSha: 'current-head' }
			)
		).toBeUndefined()
	})

	test.each([
		{ subjectType: 'file' as const, line: 1 },
		{ subjectType: 'line' as const, line: undefined },
		{ subjectType: 'line' as const, line: 0 },
	])('skips an unrepresentable $subjectType comment at $line', input => {
		expect(
			toGitHubPullRequestAnchorCoordinates(
				{ ...BASE_COMMENT, ...input, diffHunk: '@@ -1 +1 @@\n+value' },
				{ currentHeadSha: 'current-head' }
			)
		).toBeUndefined()
	})
})

describe(toGitHubDiffHunkExcerpt.name, () => {
	test('numbers context and additions on the right side', () => {
		const hunk = '@@ -4,2 +4,3 @@\n context\n+anchored\n trailing'

		expect(toGitHubDiffHunkExcerpt(hunk, 'right', 5)).toBe('anchored')
	})

	test('numbers removals on the left side', () => {
		const hunk = '@@ -9,2 +9 @@\n-removed\n context'

		expect(toGitHubDiffHunkExcerpt(hunk, 'left', 9)).toBe('removed')
	})

	test('keeps an anchored blank line distinguishable from an absent one', () => {
		expect(toGitHubDiffHunkExcerpt('@@ -1 +1 @@\n+', 'right', 1)).toBe('')
	})

	test('has no excerpt for a line the hunk does not cover', () => {
		const hunk = '@@ -1 +1 @@\n+fallback\n\\ No newline at end of file'

		expect(toGitHubDiffHunkExcerpt(hunk, 'right', 99)).toBeUndefined()
	})

	test('caps excerpts at 4096 characters', () => {
		expect(
			toGitHubDiffHunkExcerpt(`@@ -1 +1 @@\n+${'x'.repeat(5000)}`, 'right', 1)
		).toHaveLength(4096)
	})

	test('has no excerpt without a diff hunk', () => {
		expect(toGitHubDiffHunkExcerpt(undefined, 'right', 1)).toBeUndefined()
	})
})
