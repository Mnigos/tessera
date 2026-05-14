import { highlightRepositoryBlobPreview } from './repository-blob-highlighting'

describe(highlightRepositoryBlobPreview.name, () => {
	test('highlights known source files with line-level HTML', async () => {
		expect(
			await highlightRepositoryBlobPreview({
				path: 'src/index.ts',
				content: 'const answer = 42',
			})
		).toMatchObject({
			language: 'typescript',
			highlighted: {
				startLine: 1,
				lines: [
					{
						number: 1,
						html: expect.stringContaining('span'),
					},
				],
			},
		})
	})

	test('falls back for unknown filenames', async () => {
		expect(
			await highlightRepositoryBlobPreview({
				path: 'notes.tessera',
				content: 'plain text',
			})
		).toBeUndefined()
	})
})
