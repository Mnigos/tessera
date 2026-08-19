import {
	type BundledLanguage,
	createHighlighter,
	type Highlighter,
	type ThemedToken,
} from 'shiki'
import { bundledLanguages } from 'shiki/langs'

const DARK_THEME = 'github-dark'
const LIGHT_THEME = 'github-light'
const HIGHLIGHT_CACHE_LIMIT = 256
const THEME_COLOR_VARIABLES = new Set([
	'--shiki-light',
	'--shiki-dark',
	'--shiki-light-bg',
	'--shiki-dark-bg',
])
const LIGHT_STYLE_VARIABLE_PREFIX = '--shiki-light-'

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

const highlightCache = new Map<
	string,
	Promise<HighlightedSourceCode | undefined>
>()

export interface HighlightSourceCodeParams {
	content: string
	objectId?: string
	path: string
}

export interface HighlightedSourceLine {
	html: string
	number: number
}

export interface HighlightedSourceCode {
	language: string
	lines: HighlightedSourceLine[]
}

/**
 * Highlights complete source text once, emitting per-theme CSS variables so callers can select line ranges without losing multiline grammar state.
 */
export async function highlightSourceCode(
	params: HighlightSourceCodeParams
): Promise<HighlightedSourceCode | undefined> {
	if (!params.objectId) return await tokenizeSourceCode(params)

	const key = `${params.objectId}:${params.path}`
	const cached = readHighlightCache(key)

	if (cached) return await cached

	// The promise itself is cached so the near-simultaneous file-diff requests of one pull request tokenize a blob once.
	const pending = tokenizeSourceCode(params)

	writeHighlightCache(key, pending)

	return await pending
}

async function tokenizeSourceCode({
	content,
	path,
}: HighlightSourceCodeParams): Promise<HighlightedSourceCode | undefined> {
	const language = detectSourceLanguage(path)

	if (!language) return undefined

	try {
		const highlighter = await getHighlighter()
		await highlighter.loadLanguage(language)
		const { tokens } = highlighter.codeToTokens(content, {
			lang: language,
			themes: { light: LIGHT_THEME, dark: DARK_THEME },
			defaultColor: false,
		})

		return {
			language,
			lines: tokens.map((lineTokens, index) => ({
				number: index + 1,
				html: lineTokens.map(toTokenHtml).join(''),
			})),
		}
	} catch {
		return undefined
	}
}

function readHighlightCache(key: string) {
	const cached = highlightCache.get(key)

	if (!cached) return undefined

	highlightCache.delete(key)
	highlightCache.set(key, cached)

	return cached
}

function writeHighlightCache(
	key: string,
	highlighted: Promise<HighlightedSourceCode | undefined>
) {
	highlightCache.set(key, highlighted)

	if (highlightCache.size <= HIGHLIGHT_CACHE_LIMIT) return

	const oldestKey = highlightCache.keys().next().value

	if (oldestKey) highlightCache.delete(oldestKey)
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

function toTokenHtml({ content, htmlStyle }: ThemedToken) {
	const style = toTokenStyle(htmlStyle)
	const escapedContent = escapeHtml(content)

	if (!style) return escapedContent

	return `<span style="${style}">${escapedContent}</span>`
}

/** Colours stay per-theme variables the stylesheet resolves; font styles collapse to the light variant because both bundled themes derive them from the same grammar. */
function toTokenStyle(htmlStyle: Record<string, string> | undefined) {
	return Object.entries(htmlStyle ?? {})
		.flatMap(([key, value]) => {
			if (value === 'inherit') return []
			if (THEME_COLOR_VARIABLES.has(key)) return [`${key}:${value}`]
			if (!key.startsWith(LIGHT_STYLE_VARIABLE_PREFIX)) return []

			return [`${key.slice(LIGHT_STYLE_VARIABLE_PREFIX.length)}:${value}`]
		})
		.join(';')
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}
