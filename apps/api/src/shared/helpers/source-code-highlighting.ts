import {
	type BundledLanguage,
	createHighlighter,
	type Highlighter,
} from 'shiki'
import { bundledLanguages } from 'shiki/langs'

const DARK_THEME = 'github-dark'
const LIGHT_THEME = 'github-light'

const FILENAME_LANGUAGES = new Map<string, BundledLanguage>([
	['dockerfile', 'docker'],
	['makefile', 'make'],
])

const EXTENSION_LANGUAGES = new Map<string, BundledLanguage>([
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

export interface HighlightSourceCodeParams {
	content: string
	path: string
}

export interface HighlightedSourceLine {
	darkHtml: string
	lightHtml: string
	number: number
}

export interface HighlightedSourceCode {
	language: string
	lines: HighlightedSourceLine[]
}

/**
 * Highlights complete source text in both application themes so callers can select line ranges without losing multiline grammar state.
 */
export async function highlightSourceCode({
	content,
	path,
}: HighlightSourceCodeParams): Promise<HighlightedSourceCode | undefined> {
	const language = detectSourceLanguage(path)

	if (!language) return undefined

	try {
		const highlighter = await getHighlighter()
		await highlighter.loadLanguage(language)
		const lightTokens = highlighter.codeToTokens(content, {
			lang: language,
			theme: LIGHT_THEME,
		}).tokens
		const darkTokens = highlighter.codeToTokens(content, {
			lang: language,
			theme: DARK_THEME,
		}).tokens

		return {
			language,
			lines: lightTokens.map((lineTokens, index) => ({
				number: index + 1,
				lightHtml: lineTokens.map(toTokenHtml).join(''),
				darkHtml: (darkTokens[index] ?? []).map(toTokenHtml).join(''),
			})),
		}
	} catch {
		return undefined
	}
}

function detectSourceLanguage(path: string): BundledLanguage | undefined {
	const filename = path.split('/').at(-1)?.toLowerCase() ?? ''
	const filenameLanguage = FILENAME_LANGUAGES.get(filename)

	if (filenameLanguage && isBundledLanguage(filenameLanguage))
		return filenameLanguage

	const extension = filename.split('.').at(-1)

	if (!extension) return undefined

	const language = EXTENSION_LANGUAGES.get(extension)

	if (!(language && isBundledLanguage(language))) return undefined

	return language
}

function isBundledLanguage(language: string): language is BundledLanguage {
	return language in bundledLanguages
}

function getHighlighter() {
	highlighterPromise ??= createHighlighter({
		themes: [LIGHT_THEME, DARK_THEME],
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
	const escapedContent = escapeHtml(content)

	if (!style) return escapedContent

	return `<span style="${style}">${escapedContent}</span>`
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}
