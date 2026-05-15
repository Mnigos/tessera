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

	test('falls back for paths without a usable filename extension', async () => {
		expect(
			await highlightRepositoryBlobPreview({
				path: '/',
				content: 'plain text',
			})
		).toBeUndefined()
	})

	test('detects known special filenames without extensions', async () => {
		expect(
			await highlightRepositoryBlobPreview({
				path: 'Dockerfile',
				content: 'FROM oven/bun:1',
			})
		).toMatchObject({
			language: 'docker',
		})
	})

	test('falls back when highlighting throws for a known language', async () => {
		vi.resetModules()
		vi.doMock('shiki', () => ({
			createHighlighter: vi.fn().mockResolvedValue({
				loadLanguage: vi.fn(),
				codeToTokens: vi.fn(() => {
					throw new Error('highlight failed')
				}),
			}),
		}))
		vi.doMock('shiki/langs', () => ({
			bundledLanguages: { typescript: {} },
		}))
		const { highlightRepositoryBlobPreview: highlightWithFailingShiki } =
			await import('./repository-blob-highlighting')

		expect(
			await highlightWithFailingShiki({
				path: 'src/broken.ts',
				content: 'const answer = 42',
			})
		).toBeUndefined()
		vi.doUnmock('shiki')
		vi.doUnmock('shiki/langs')
	})
})
