import { highlightSourceCode } from './source-code-highlighting'

describe(highlightSourceCode.name, () => {
	test('highlights complete source in both themes and escapes markup', async () => {
		const highlighted = await highlightSourceCode({
			path: 'src/example.ts',
			content: 'const value = "<unsafe>"',
		})

		expect(highlighted).toMatchObject({
			language: 'typescript',
			lines: [
				{
					number: 1,
					lightHtml: expect.stringContaining('&lt;unsafe&gt;'),
					darkHtml: expect.stringContaining('&lt;unsafe&gt;'),
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
