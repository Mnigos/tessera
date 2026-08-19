import type { GitStorageRepositoryFileDiff } from '@config/git-storage'
import {
	highlightPullRequestDiff,
	highlightPullRequestFileLines,
} from './pull-request-diff-highlighting'

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
			html: expect.stringContaining('span'),
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
		expect(result.hunks[0]?.lines[0]?.html).toBeUndefined()
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
		expect(result.hunks[0]?.lines[0]?.html).toBeUndefined()
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
				objectId: 'multiline-base-blob',
				sizeBytes: content.length,
				preview: { type: 'text', content },
			},
			headBlob: {
				objectId: 'multiline-head-blob',
				sizeBytes: content.length,
				preview: { type: 'text', content },
			},
		})

		expect(result.hunks[0]?.lines[0]?.html).toContain('span')
		expect(result.hunks[0]?.lines[0]?.html).toContain('still inside template')
	})
})

describe('word-level emphasis', () => {
	const toPairedDiff = (
		deletion: string,
		addition: string
	): GitStorageRepositoryFileDiff => ({
		...diff,
		hunks: [
			{
				header: '@@ -1 +1 @@',
				lines: [
					{ kind: 'deletion', content: deletion, oldLine: 1 },
					{ kind: 'addition', content: addition, newLine: 1 },
				],
			},
		],
	})

	const highlightPair = async (deletion: string, addition: string) =>
		await highlightPullRequestDiff({
			diff: toPairedDiff(deletion, addition),
			baseBlob: {
				objectId: `base-${deletion}`,
				sizeBytes: deletion.length,
				preview: { type: 'text', content: deletion },
			},
			headBlob: {
				objectId: `head-${addition}`,
				sizeBytes: addition.length,
				preview: { type: 'text', content: addition },
			},
		})

	test('marks only what changed between a paired removal and addition', async () => {
		const result = await highlightPair('const answer = 41', 'const answer = 42')

		expect(result.hunks[0]?.lines[0]?.html).toContain('<span class="dw">41')
		expect(result.hunks[0]?.lines[1]?.html).toContain('<span class="dw">42')
		expect(result.hunks[0]?.lines[1]?.html).not.toContain(
			'<span class="dw">answer'
		)
	})

	test('leaves rewrites unmarked below the similarity threshold', async () => {
		const result = await highlightPair(
			'const answer = 41',
			'export function computeEverything(input: string[]) {'
		)

		expect(result.hunks[0]?.lines[0]?.html).not.toContain('class="dw"')
		expect(result.hunks[0]?.lines[1]?.html).not.toContain('class="dw"')
	})

	test('leaves unpaired surplus lines of an uneven run unmarked', async () => {
		const result = await highlightPullRequestDiff({
			diff: {
				...diff,
				hunks: [
					{
						header: '@@ -1,1 +1,2 @@',
						lines: [
							{ kind: 'deletion', content: 'const a = 1', oldLine: 1 },
							{ kind: 'addition', content: 'const a = 2', newLine: 1 },
							{ kind: 'addition', content: 'const b = 3', newLine: 2 },
						],
					},
				],
			},
			baseBlob: undefined,
			headBlob: undefined,
		})

		expect(result.hunks[0]?.lines[1]?.html).toContain('<span class="dw">2')
		expect(result.hunks[0]?.lines[2]?.html).toBeUndefined()
	})

	test('skips lines longer than the emphasis limit', async () => {
		const result = await highlightPair(
			`const a = '${'x'.repeat(1200)}'`,
			`const a = '${'y'.repeat(1200)}'`
		)

		expect(result.hunks[0]?.lines[0]?.html).not.toContain('class="dw"')
	})
})

describe(highlightPullRequestFileLines.name, () => {
	const content = 'const one = 1\nconst two = 2\nconst three = 3\n'

	test('serves a slice of one blob as context lines anchored on that side', async () => {
		const result = await highlightPullRequestFileLines({
			content,
			objectId: 'head-blob-lines',
			path: 'src/example.ts',
			sha: 'head-sha',
			side: 'right',
			startLine: 2,
			endLine: 3,
		})

		expect(result.totalLines).toBe(3)
		expect(result.lines).toHaveLength(2)
		expect(result.lines[0]).toMatchObject({
			kind: 'context',
			content: 'const two = 2',
			html: expect.stringContaining('span'),
			new: { sha: 'head-sha', path: 'src/example.ts', line: 2, side: 'right' },
		})
		expect(result.lines[0]?.old).toBeUndefined()
	})

	test('clamps a range that runs past the end of the file', async () => {
		const result = await highlightPullRequestFileLines({
			content,
			objectId: 'head-blob-lines',
			path: 'src/example.ts',
			sha: 'head-sha',
			side: 'left',
			startLine: 3,
			endLine: 40,
		})

		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]?.old?.line).toBe(3)
	})
})
