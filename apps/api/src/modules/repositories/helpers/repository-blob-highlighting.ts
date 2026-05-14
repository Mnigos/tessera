import {
	type BundledLanguage,
	createHighlighter,
	type Highlighter,
} from 'shiki'
import { bundledLanguages } from 'shiki/langs'

const HIGHLIGHT_THEME = 'github-light'

const filenameLanguages = new Map<string, BundledLanguage>([
	['dockerfile', 'docker'],
	['makefile', 'make'],
])

const extensionLanguages = new Map<string, BundledLanguage>([
	['css', 'css'],
	['go', 'go'],
	['html', 'html'],
	['java', 'java'],
	['js', 'javascript'],
	['json', 'json'],
	['jsx', 'jsx'],
	['md', 'markdown'],
	['py', 'python'],
	['rs', 'rust'],
	['sh', 'shellscript'],
	['sql', 'sql'],
	['ts', 'typescript'],
	['tsx', 'tsx'],
	['yaml', 'yaml'],
	['yml', 'yaml'],
])

let highlighterPromise: Promise<Highlighter> | undefined

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
	const language = detectRepositoryBlobLanguage(path)

	if (!language) return undefined

	try {
		const highlighter = await getHighlighter()
		await highlighter.loadLanguage(language)
		const { tokens } = highlighter.codeToTokens(content, {
			lang: language,
			theme: HIGHLIGHT_THEME,
		})

		return {
			language,
			highlighted: {
				startLine: 1,
				lines: tokens.map((lineTokens, index) => ({
					number: index + 1,
					html: lineTokens.map(toTokenHtml).join(''),
				})),
			},
		}
	} catch {
		return undefined
	}
}

function detectRepositoryBlobLanguage(
	path: string
): BundledLanguage | undefined {
	const filename = path.split('/').at(-1)?.toLowerCase() ?? ''
	const filenameLanguage = filenameLanguages.get(filename)

	if (filenameLanguage && isBundledLanguage(filenameLanguage))
		return filenameLanguage

	const extension = filename.split('.').at(-1)

	if (!extension) return undefined

	const language = extensionLanguages.get(extension)

	if (!(language && isBundledLanguage(language))) return undefined

	return language
}

function isBundledLanguage(language: string): language is BundledLanguage {
	return language in bundledLanguages
}

function getHighlighter() {
	highlighterPromise ??= createHighlighter({
		themes: [HIGHLIGHT_THEME],
		langs: [],
	})

	return highlighterPromise
}

function toTokenHtml({
	color,
	content,
	fontStyle,
}: {
	color?: string
	content: string
	fontStyle?: number
}) {
	const style = [
		color ? `color:${color}` : undefined,
		fontStyle === 1 || fontStyle === 3 ? 'font-style:italic' : undefined,
		fontStyle === 2 || fontStyle === 3 ? 'font-weight:bold' : undefined,
	]
		.filter(Boolean)
		.join(';')

	if (!style) return escapeHtml(content)

	return `<span style="${style}">${escapeHtml(content)}</span>`
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}
