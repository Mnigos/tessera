import { highlightSourceCode } from '~/shared/helpers/source-code-highlighting'

export interface HighlightRepositoryBlobPreviewParams {
	content: string
	path: string
}

export interface HighlightedRepositoryBlobPreview {
	language: string
	highlighted: {
		startLine: number
		lines: {
			number: number
			html: string
		}[]
	}
}

export async function highlightRepositoryBlobPreview({
	content,
	path,
}: HighlightRepositoryBlobPreviewParams): Promise<
	HighlightedRepositoryBlobPreview | undefined
> {
	const highlighted = await highlightSourceCode({ content, path })

	if (!highlighted) return undefined

	return {
		language: highlighted.language,
		highlighted: {
			startLine: 1,
			lines: highlighted.lines.map(line => ({
				number: line.number,
				html: line.lightHtml,
			})),
		},
	}
}
