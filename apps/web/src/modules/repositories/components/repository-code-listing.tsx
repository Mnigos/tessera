import type { RepositoryBlob } from '@repo/contracts'
import { cn } from '@repo/ui/utils'

const plainTextLineSeparatorRegex = /\r?\n/

interface RepositoryCodeListingProps {
	blob: RepositoryBlob & {
		preview: Extract<RepositoryBlob['preview'], { type: 'text' }>
	}
}

export function RepositoryCodeListing({
	blob,
}: Readonly<RepositoryCodeListingProps>) {
	const rows = getCodeRows(blob.preview)

	return (
		<pre className="overflow-x-auto bg-background py-3 text-sm leading-6">
			<code className="block min-w-max">
				{rows.map(row => (
					<CodeLineRow
						html={row.html}
						key={row.number}
						lineNumber={row.number}
						path={blob.path}
						refName={blob.ref}
						text={row.text}
					/>
				))}
			</code>
		</pre>
	)
}

interface CodeLineRowProps {
	html?: string
	lineNumber: number
	path: string
	refName: string
	text?: string
}

function CodeLineRow({
	html,
	lineNumber,
	path,
	refName,
	text,
}: Readonly<CodeLineRowProps>) {
	return (
		<span
			className="grid min-h-6 grid-cols-[4.5rem_1fr] hover:bg-muted/50"
			data-line-number={lineNumber}
			data-path={path}
			data-ref={refName}
			data-testid="repository-blob-code-row"
		>
			<span
				aria-hidden="true"
				className="select-none border-border border-r px-4 text-right font-mono text-muted-foreground"
			>
				{lineNumber}
			</span>
			<CodeLineContent html={html} text={text} />
		</span>
	)
}

interface CodeLineContentProps {
	html?: string
	text?: string
}

function CodeLineContent({ html, text }: Readonly<CodeLineContentProps>) {
	const className = cn(
		'px-4 font-mono text-foreground [tab-size:2] [&_.hljs-attr]:text-sky-300 [&_.hljs-built_in]:text-indigo-300 [&_.hljs-comment]:text-muted-foreground [&_.hljs-keyword]:text-fuchsia-300 [&_.hljs-literal]:text-teal-300 [&_.hljs-number]:text-teal-300 [&_.hljs-string]:text-emerald-300 [&_.hljs-title]:text-amber-200',
		!(text || html) && 'min-w-4'
	)

	if (html)
		return (
			<span className={className} dangerouslySetInnerHTML={{ __html: html }} />
		)

	return <span className={className}>{text}</span>
}

interface CodeRow {
	number: number
	html?: string
	text?: string
}

interface HighlightedCodeLine {
	number: number
	html: string
}

interface HighlightedBlobPreview {
	highlighted?: {
		startLine: number
		lines: HighlightedCodeLine[]
	}
	highlightedRows?: HighlightedCodeLine[]
	rows?: HighlightedCodeLine[]
}

function getCodeRows(
	preview: Extract<RepositoryBlob['preview'], { type: 'text' }>
): CodeRow[] {
	const highlightedRows = getHighlightedRows(preview)

	if (highlightedRows.length > 0)
		return highlightedRows.map(row => ({
			number: row.number,
			html: row.html,
		}))

	return getPlainTextLines(preview.content).map((text, index) => ({
		number: index + 1,
		text,
	}))
}

function getHighlightedRows(
	preview: Extract<RepositoryBlob['preview'], { type: 'text' }>
) {
	const highlightedPreview = preview as typeof preview & HighlightedBlobPreview

	return (
		highlightedPreview.highlighted?.lines ??
		highlightedPreview.highlightedRows ??
		highlightedPreview.rows ??
		[]
	)
}

function getPlainTextLines(content: string) {
	const lines = content.split(plainTextLineSeparatorRegex)

	if (lines.at(-1) === '') return lines.slice(0, -1)

	return lines
}
