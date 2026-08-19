import {
	highlightSourceCode,
	toHighlightedLineHtml,
} from './source-code-highlighting'

describe(highlightSourceCode.name, () => {
	test('highlights complete source with per-theme variables and escapes markup', async () => {
		const highlighted = await highlightSourceCode({
			path: 'src/example.ts',
			content: 'const value = "<unsafe>"',
		})

		expect(highlighted?.language).toBe('typescript')
		expect(highlighted?.lines[0]?.number).toBe(1)
		expect(
			toHighlightedLineHtml(highlighted?.lines[0]?.tokens ?? [])
		).toContain('&lt;unsafe&gt;')
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

describe(toHighlightedLineHtml.name, () => {
	test('cuts marks at token edges and folds them in before escaping', () => {
		expect(
			toHighlightedLineHtml(
				[
					{ content: 'const a = ', style: '' },
					{ content: '"<b>"', style: 'color:red' },
				],
				[{ start: 6, end: 12 }]
			)
		).toBe(
			'const <span class="dw">a = </span><span style="color:red"><span class="dw">&quot;&lt;</span>b&gt;&quot;</span>'
		)
	})
})
