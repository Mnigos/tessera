import type { SourceLineMark } from '~/shared/helpers/source-code-highlighting'

const MAX_LINE_LENGTH = 1000
const MAX_TOKEN_COUNT = 400
const MIN_SIMILARITY = 0.35
/** Identifiers, whitespace runs, then one code point each, so `=>` and `::` mark as their own pieces. */
const TOKEN_PATTERN = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/gu

export interface WordDiffMarks {
	addition: SourceLineMark[]
	deletion: SourceLineMark[]
}

interface WordDiffToken {
	start: number
	value: string
}

/**
 * The character ranges that separate a removed line from the added line that
 * replaced it, in raw source coordinates.
 *
 * Nothing is returned when the two lines are too far apart to read as one
 * edit — a rewrite marked end to end says less than a rewrite left alone.
 */
export function toWordDiffMarks(
	deletion: string,
	addition: string
): WordDiffMarks | undefined {
	if (deletion === addition) return undefined
	if (deletion.length > MAX_LINE_LENGTH || addition.length > MAX_LINE_LENGTH)
		return undefined

	const deletionTokens = toWordDiffTokens(deletion)
	const additionTokens = toWordDiffTokens(addition)

	if (
		deletionTokens.length > MAX_TOKEN_COUNT ||
		additionTokens.length > MAX_TOKEN_COUNT
	)
		return undefined

	const { commonLength, leftMatched, rightMatched } = toCommonSubsequence(
		deletionTokens,
		additionTokens
	)
	const similarity =
		(2 * commonLength) / (deletion.length + addition.length || 1)

	if (similarity < MIN_SIMILARITY) return undefined

	const marks = {
		deletion: toMarks(deletionTokens, leftMatched),
		addition: toMarks(additionTokens, rightMatched),
	}

	if (
		coversWholeLine(marks.deletion, deletion) ||
		coversWholeLine(marks.addition, addition)
	)
		return undefined

	return marks
}

function toWordDiffTokens(line: string): WordDiffToken[] {
	return [...line.matchAll(TOKEN_PATTERN)].map(match => ({
		start: match.index,
		value: match[0],
	}))
}

/** Longest common subsequence over tokens; the unmatched ones are what changed. */
function toCommonSubsequence(left: WordDiffToken[], right: WordDiffToken[]) {
	const width = right.length + 1
	const lengths = new Uint16Array((left.length + 1) * width)

	for (let row = left.length - 1; row >= 0; row--)
		for (let column = right.length - 1; column >= 0; column--)
			lengths[row * width + column] =
				left[row]?.value === right[column]?.value
					? (lengths[(row + 1) * width + column + 1] ?? 0) + 1
					: Math.max(
							lengths[(row + 1) * width + column] ?? 0,
							lengths[row * width + column + 1] ?? 0
						)

	const leftMatched = Array.from({ length: left.length }, () => false)
	const rightMatched = Array.from({ length: right.length }, () => false)
	let commonLength = 0
	let row = 0
	let column = 0

	while (row < left.length && column < right.length) {
		const leftToken = left[row]
		const rightToken = right[column]

		if (leftToken && leftToken.value === rightToken?.value) {
			leftMatched[row] = true
			rightMatched[column] = true
			commonLength += leftToken.value.length
			row++
			column++
			continue
		}

		if (
			(lengths[(row + 1) * width + column] ?? 0) >=
			(lengths[row * width + column + 1] ?? 0)
		)
			row++
		else column++
	}

	return { commonLength, leftMatched, rightMatched }
}

function toMarks(tokens: WordDiffToken[], matched: boolean[]) {
	const marks: SourceLineMark[] = []

	for (const [index, token] of tokens.entries()) {
		if (matched[index]) continue

		const end = token.start + token.value.length
		const previous = marks.at(-1)

		if (previous?.end === token.start) previous.end = end
		else marks.push({ start: token.start, end })
	}

	return marks
}

function coversWholeLine(marks: SourceLineMark[], line: string) {
	const marked = marks.reduce((total, mark) => total + mark.end - mark.start, 0)

	return marked >= line.length
}
