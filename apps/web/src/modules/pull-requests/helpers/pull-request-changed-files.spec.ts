import type { PullRequestChangedFile } from '@repo/contracts'
import {
	buildPullRequestFileTree,
	flattenPullRequestFileTree,
	getChangedFilePath,
	isLargeChangedFile,
} from './pull-request-changed-files'

function changedFile(
	path: string,
	overrides: Partial<PullRequestChangedFile> = {}
): PullRequestChangedFile {
	return {
		status: 'modified',
		oldPath: path,
		newPath: path,
		baseBlobId: `base-${path}`,
		headBlobId: `head-${path}`,
		additions: 1,
		deletions: 1,
		isBinary: false,
		...overrides,
	}
}

describe('pull request changed files', () => {
	test('uses the removed path for deleted files', () => {
		expect(
			getChangedFilePath(
				changedFile('src/removed.ts', {
					status: 'deleted',
					newPath: '',
				})
			)
		).toBe('src/removed.ts')
	})

	test.each([
		[800, false, false],
		[801, false, true],
		[2, true, true],
	] as const)('classifies %i changed lines with binary=%s as large=%s', (changedLines, isBinary, expected) => {
		expect(
			isLargeChangedFile(
				changedFile('src/index.ts', {
					additions: changedLines - 1,
					deletions: 1,
					isBinary,
				})
			)
		).toBe(expected)
	})

	test('keeps directory and file keys separate, merges lone directories, and preserves order', () => {
		const docsFile = changedFile('docs')
		const nestedFile = changedFile('docs/readme.md')
		const sourceFile = changedFile('src/modules/pulls/index.ts')
		const rootFile = changedFile('LICENSE')

		expect(
			buildPullRequestFileTree([docsFile, nestedFile, sourceFile, rootFile])
		).toEqual([
			{ kind: 'file', name: 'docs', path: 'docs', file: docsFile },
			{
				kind: 'directory',
				name: 'docs',
				path: 'docs',
				children: [
					{
						kind: 'file',
						name: 'readme.md',
						path: 'docs/readme.md',
						file: nestedFile,
					},
				],
			},
			{
				kind: 'directory',
				name: 'src/modules/pulls',
				path: 'src/modules/pulls',
				children: [
					{
						kind: 'file',
						name: 'index.ts',
						path: 'src/modules/pulls/index.ts',
						file: sourceFile,
					},
				],
			},
			{ kind: 'file', name: 'LICENSE', path: 'LICENSE', file: rootFile },
		])
	})

	test('omits descendants of collapsed directories when flattening', () => {
		const nodes = buildPullRequestFileTree([
			changedFile('src/api/index.ts'),
			changedFile('src/web/index.ts'),
			changedFile('README.md'),
		])

		expect(flattenPullRequestFileTree(nodes, ['src/api'])).toEqual([
			expect.objectContaining({
				depth: 0,
				node: expect.objectContaining({ name: 'src', path: 'src' }),
			}),
			expect.objectContaining({
				depth: 1,
				node: expect.objectContaining({ name: 'api', path: 'src/api' }),
			}),
			expect.objectContaining({
				depth: 1,
				node: expect.objectContaining({ name: 'web', path: 'src/web' }),
			}),
			expect.objectContaining({
				depth: 2,
				node: expect.objectContaining({
					name: 'index.ts',
					path: 'src/web/index.ts',
				}),
			}),
			expect.objectContaining({
				depth: 0,
				node: expect.objectContaining({
					name: 'README.md',
					path: 'README.md',
				}),
			}),
		])
	})
})
