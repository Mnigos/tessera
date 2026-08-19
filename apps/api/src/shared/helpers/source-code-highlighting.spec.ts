import { highlightSourceCode } from './source-code-highlighting'

describe(highlightSourceCode.name, () => {
	test('highlights complete source with per-theme variables and escapes markup', async () => {
		const highlighted = await highlightSourceCode({
			path: 'src/example.ts',
			content: 'const value = "<unsafe>"',
		})

		expect(highlighted).toMatchObject({
			language: 'typescript',
			lines: [
				{
					number: 1,
					html: expect.stringContaining('&lt;unsafe&gt;'),
				},
			],
		})
	})

	test('returns undefined for unknown languages', async () => {
		expect(
			await highlightSourceCode({
				path: 'notes.tessera',
				content: 'plain text',
			})
		).toBeUndefined()
	})
})
