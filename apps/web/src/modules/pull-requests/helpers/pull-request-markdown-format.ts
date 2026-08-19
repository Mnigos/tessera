const MARKDOWN_WRAPPERS = {
	bold: '**',
	code: '`',
	italic: '_',
} as const

export type PullRequestMarkdownFormat =
	| keyof typeof MARKDOWN_WRAPPERS
	| 'link'
	| 'list'

const LINK_PLACEHOLDER = 'url'

/**
 * Applies a toolbar format to whatever the writer has selected and returns the
 * resulting body. The edit goes through `setRangeText` so the browser keeps its
 * own undo history: a toolbar that cannot be undone is worse than no toolbar.
 */
export function applyPullRequestMarkdownFormat(
	textarea: HTMLTextAreaElement,
	format: PullRequestMarkdownFormat
) {
	const { selectionEnd, selectionStart, value } = textarea
	const selected = value.slice(selectionStart, selectionEnd)

	textarea.focus()

	if (format === 'list') {
		const blockStart = value.lastIndexOf('\n', selectionStart - 1) + 1
		const block = value.slice(blockStart, selectionEnd)
		const bulleted = block
			.split('\n')
			.map(line => (line.startsWith('- ') ? line : `- ${line}`))
			.join('\n')

		textarea.setRangeText(bulleted, blockStart, selectionEnd, 'end')

		return textarea.value
	}

	if (format === 'link') {
		textarea.setRangeText(
			`[${selected}](${LINK_PLACEHOLDER})`,
			selectionStart,
			selectionEnd,
			'end'
		)

		// Leaves the placeholder selected, so typing the address replaces it.
		const placeholderStart = selectionStart + selected.length + 3

		textarea.setSelectionRange(
			placeholderStart,
			placeholderStart + LINK_PLACEHOLDER.length
		)

		return textarea.value
	}

	const wrapper = MARKDOWN_WRAPPERS[format]

	textarea.setRangeText(
		`${wrapper}${selected}${wrapper}`,
		selectionStart,
		selectionEnd,
		'end'
	)

	if (selected.length === 0) {
		const caret = selectionStart + wrapper.length

		textarea.setSelectionRange(caret, caret)
	}

	return textarea.value
}
