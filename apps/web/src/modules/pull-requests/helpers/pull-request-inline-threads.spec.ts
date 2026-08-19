import type {
	PullRequestChangedFile,
	PullRequestThread,
	PullRequestThreadId,
} from '@repo/contracts'
import {
	getInlineThreadsForFile,
	getInlineThreadsForLine,
	getLeftoverInlineThreads,
	getOutdatedInlineThreads,
	getUnanchoredInlineThreads,
	toThreadLineExcerpt,
} from './pull-request-inline-threads'

const createdAt = new Date('2026-08-06T10:00:00.000Z')

function inlineAnchor(path: string): NonNullable<PullRequestThread['anchor']> {
	return {
		path,
		side: 'right',
		startLine: 7,
		endLine: 7,
		anchorSha: 'a'.repeat(40),
		baseSha: 'b'.repeat(40),
		headSha: 'c'.repeat(40),
		lineExcerpt: 'const value = 1',
	}
}

function inlineThread(id: string, path: string): PullRequestThread {
	const anchor = inlineAnchor(path)

	return {
		id: id as PullRequestThreadId,
		kind: 'inline',
		anchor,
		currentAnchor: {
			path,
			side: anchor.side,
			startLine: anchor.startLine,
			endLine: anchor.endLine,
		},
		outdated: false,
		createdAt,
		comments: [],
	}
}

const renamedFile = {
	status: 'renamed',
	oldPath: 'src/old.ts',
	newPath: 'src/new.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	additions: 1,
	deletions: 1,
	isBinary: false,
} satisfies PullRequestChangedFile

describe('pull request inline threads', () => {
	test('claims threads anchored to either side of a renamed file', () => {
		const threads = [
			inlineThread('00000000-0000-4000-8000-000000000001', 'src/old.ts'),
			inlineThread('00000000-0000-4000-8000-000000000002', 'src/new.ts'),
			inlineThread('00000000-0000-4000-8000-000000000003', 'src/other.ts'),
		]

		expect(
			getInlineThreadsForFile(threads, renamedFile, [renamedFile]).map(
				thread => thread.id
			)
		).toEqual([
			'00000000-0000-4000-8000-000000000001',
			'00000000-0000-4000-8000-000000000002',
		])
	})

	test('yields old-path threads to a file that now occupies that path', () => {
		const recreatedFile = {
			...renamedFile,
			status: 'added',
			oldPath: 'src/old.ts',
			newPath: 'src/old.ts',
		} satisfies PullRequestChangedFile
		const files = [renamedFile, recreatedFile]
		const threads = [
			inlineThread('00000000-0000-4000-8000-000000000001', 'src/old.ts'),
		]

		expect(getInlineThreadsForFile(threads, renamedFile, files)).toEqual([])
		expect(
			getInlineThreadsForFile(threads, recreatedFile, files).map(
				thread => thread.id
			)
		).toEqual(['00000000-0000-4000-8000-000000000001'])
	})

	test('surfaces threads whose file left the comparison or renders no diff', () => {
		const missing = inlineThread(
			'00000000-0000-4000-8000-000000000004',
			'src/deleted.ts'
		)
		const binary = inlineThread(
			'00000000-0000-4000-8000-000000000005',
			'assets/logo.png'
		)
		const renamed = inlineThread(
			'00000000-0000-4000-8000-000000000006',
			'src/old.ts'
		)

		expect(
			getUnanchoredInlineThreads(
				[missing, binary, renamed],
				[
					renamedFile,
					{
						...renamedFile,
						status: 'modified',
						oldPath: 'assets/logo.png',
						newPath: 'assets/logo.png',
						isBinary: true,
					},
				]
			).map(thread => thread.id)
		).toEqual([
			'00000000-0000-4000-8000-000000000004',
			'00000000-0000-4000-8000-000000000005',
		])
	})

	test('keeps top-level threads out of the unanchored list', () => {
		const topLevel: PullRequestThread = {
			id: '00000000-0000-4000-8000-000000000007' as PullRequestThreadId,
			kind: 'top_level',
			outdated: false,
			createdAt,
			comments: [],
		}

		expect(getUnanchoredInlineThreads([topLevel], [])).toEqual([])
	})

	test('matches current lines by side and line while excluding outdated threads', () => {
		const matching = inlineThread(
			'00000000-0000-4000-8000-000000000008',
			'src/new.ts'
		)
		const wrongSide = {
			...inlineThread('00000000-0000-4000-8000-000000000009', 'src/new.ts'),
			anchor: { ...inlineAnchor('src/new.ts'), side: 'left' as const },
			currentAnchor: {
				path: 'src/new.ts',
				side: 'left' as const,
				startLine: 7,
				endLine: 7,
			},
		}
		const outdated = {
			...matching,
			id: '00000000-0000-4000-8000-000000000010' as PullRequestThreadId,
			currentAnchor: undefined,
			outdated: true,
		}

		expect(
			getInlineThreadsForLine([matching, wrongSide, outdated], 'right', 7)
		).toEqual([matching])
		expect(getOutdatedInlineThreads([matching, wrongSide, outdated])).toEqual([
			outdated,
		])
	})

	test('collects outdated threads and threads on lines outside rendered hunks', () => {
		const rendered = inlineThread(
			'00000000-0000-4000-8000-000000000011',
			'src/new.ts'
		)
		const offHunk = {
			...inlineThread('00000000-0000-4000-8000-000000000012', 'src/new.ts'),
			anchor: { ...inlineAnchor('src/new.ts'), startLine: 99, endLine: 99 },
			currentAnchor: {
				path: 'src/new.ts',
				side: 'right' as const,
				startLine: 99,
				endLine: 99,
			},
		}
		const outdated = {
			...inlineThread('00000000-0000-4000-8000-000000000013', 'src/new.ts'),
			currentAnchor: undefined,
			outdated: true,
		}
		const diff = {
			baseSha: 'b'.repeat(40),
			headSha: 'c'.repeat(40),
			mergeBaseSha: 'd'.repeat(40),
			file: renamedFile,
			hunks: [
				{
					header: '@@ -7,1 +7,1 @@',
					lines: [
						{
							kind: 'addition' as const,
							content: 'const value = 1',
							new: {
								sha: 'c'.repeat(40),
								path: 'src/new.ts',
								line: 7,
								side: 'right' as const,
							},
						},
					],
				},
			],
			isTruncated: false,
			patchLimitBytes: 1_048_576,
		}

		expect(
			getLeftoverInlineThreads([rendered, offHunk, outdated], diff).map(
				thread => thread.id
			)
		).toEqual([
			'00000000-0000-4000-8000-000000000012',
			'00000000-0000-4000-8000-000000000013',
		])
	})

	test('truncates a line excerpt to the contracted bound', () => {
		expect(toThreadLineExcerpt('a'.repeat(5000))).toHaveLength(4096)
		expect(toThreadLineExcerpt('short line')).toBe('short line')
	})
})
