import type { GitStorageRepositoryFileDiff } from '@config/git-storage'
import { highlightPullRequestDiff } from './pull-request-diff-highlighting'

const diff: GitStorageRepositoryFileDiff = {
	baseSha: 'base-sha',
	headSha: 'head-sha',
	mergeBaseSha: 'merge-base-sha',
	file: {
		status: 'modified',
		oldPath: 'src/example.ts',
		newPath: 'src/example.ts',
		baseBlobId: 'base-blob',
		headBlobId: 'head-blob',
		additions: 1,
		deletions: 0,
		isBinary: false,
	},
	hunks: [
		{
			header: '@@ -3,1 +3,2 @@',
			lines: [
				{
					kind: 'context',
					content: 'still commented',
					oldLine: 3,
					newLine: 3,
				},
				{
					kind: 'addition',
					content: 'const answer = 42',
					newLine: 4,
				},
			],
		},
	],
	isTruncated: false,
	patchLimitBytes: 1024,
}

describe(highlightPullRequestDiff.name, () => {
	test('highlights complete files before selecting visible multiline lines', async () => {
		const result = await highlightPullRequestDiff({
			diff,
			baseBlob: {
				objectId: 'base-blob',
				sizeBytes: 30,
				preview: {
					type: 'text',
					content: '/* start\nhidden\nstill commented\n*/',
				},
			},
			headBlob: {
				objectId: 'head-blob',
				sizeBytes: 50,
				preview: {
					type: 'text',
					content: '/* start\nhidden\nstill commented\nconst answer = 42\n*/',
				},
			},
		})

		expect(result.language).toBe('typescript')
		expect(result.hunks[0]?.lines[0]).toMatchObject({
			lightHtml: expect.stringContaining('span'),
			darkHtml: expect.stringContaining('span'),
			old: {
				sha: 'merge-base-sha',
				path: 'src/example.ts',
				line: 3,
				side: 'left',
			},
			new: {
				sha: 'head-sha',
				path: 'src/example.ts',
				line: 3,
				side: 'right',
			},
		})
	})

	test('falls back to raw lines for binary blobs', async () => {
		const result = await highlightPullRequestDiff({
			diff,
			baseBlob: undefined,
			headBlob: {
				objectId: 'head-blob',
				sizeBytes: 4,
				preview: { type: 'binary' },
			},
		})

		expect(result.language).toBeUndefined()
		expect(result.hunks[0]?.lines[0]?.lightHtml).toBeUndefined()
	})

	test('falls back to raw lines when full-file highlighting is oversized', async () => {
		const result = await highlightPullRequestDiff({
			diff,
			baseBlob: undefined,
			headBlob: {
				objectId: 'head-blob',
				sizeBytes: 2_097_152,
				preview: { type: 'tooLarge', previewLimitBytes: 1_048_576 },
			},
		})

		expect(result.language).toBeUndefined()
		expect(result.hunks[0]?.lines[0]?.darkHtml).toBeUndefined()
	})

	test('preserves multiline string highlighting across hidden ranges', async () => {
		const multilineStringDiff: GitStorageRepositoryFileDiff = {
			...diff,
			hunks: [
				{
					header: '@@ -3 +3 @@',
					lines: [
						{
							kind: 'context',
							content: 'still inside template',
							oldLine: 3,
							newLine: 3,
						},
					],
				},
			],
		}
		const content = 'const message = `start\nhidden\nstill inside template\n`'

		const result = await highlightPullRequestDiff({
			diff: multilineStringDiff,
			baseBlob: {
				objectId: 'base-blob',
				sizeBytes: content.length,
				preview: { type: 'text', content },
			},
			headBlob: {
				objectId: 'head-blob',
				sizeBytes: content.length,
				preview: { type: 'text', content },
			},
		})

		expect(result.hunks[0]?.lines[0]?.darkHtml).toContain('span')
		expect(result.hunks[0]?.lines[0]?.darkHtml).toContain(
			'still inside template'
		)
	})
})
