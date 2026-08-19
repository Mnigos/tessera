import type {
	GetPullRequestFileDiffInput,
	PullRequestChangedFile,
	PullRequestFileDiff,
	PullRequestThreadSide,
} from '@repo/contracts'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { cn } from '@repo/ui/utils'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, useState } from 'react'
import { getChangedFilePath } from '../helpers/pull-request-changed-files'
import { getPullRequestFileDiffQueryOptions } from '../hooks/use-pull-request-file-diff.query'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'
import {
	FILE_STATUS_CLASSES,
	FILE_STATUS_LETTERS,
} from './pull-request-file-section'

const OPTION_ID_PREFIX = 'pull-request-jump-option'

/** Where the palette jumps to: a whole file, or one line inside a loaded diff. */
export interface PullRequestDiffMatch {
	path: string
	side?: PullRequestThreadSide
	line?: number
	preview?: string
}

interface PullRequestJumpResult extends PullRequestDiffMatch {
	key: string
	file: PullRequestChangedFile
}

interface PullRequestJumpToFileProps {
	/** Which palette is up; nothing renders while it is closed. */
	mode?: 'find' | 'jump'
	onOpenChange: (isOpen: boolean) => void
	files: readonly PullRequestChangedFile[]
	viewedPaths?: ReadonlySet<string>
	diffInput: Omit<GetPullRequestFileDiffInput, 'path'>
	onSelect: (match: PullRequestDiffMatch) => void
}

const MAX_RESULTS = 80
const MIN_FIND_LENGTH = 2
const PREVIEW_LENGTH = 160

/**
 * One palette for both jumps: ⌘K filters the changed files, ⌘F also reads the
 * diffs already in the cache. Nothing is fetched — a file nobody opened is
 * counted, not loaded, so find stays instant on a 300-file comparison.
 */
export function PullRequestJumpToFile({
	mode,
	onOpenChange,
	files,
	viewedPaths,
	diffInput,
	onSelect,
}: Readonly<PullRequestJumpToFileProps>) {
	return (
		<Dialog onOpenChange={onOpenChange} open={mode !== undefined}>
			<DialogContent className="top-24 translate-y-0 gap-3 p-0 sm:max-w-2xl">
				{mode && (
					// The query is per opening, so re-opening never reruns the last search.
					<PullRequestJumpPanel
						diffInput={diffInput}
						files={files}
						key={mode}
						mode={mode}
						onSelect={match => {
							onOpenChange(false)
							onSelect(match)
						}}
						viewedPaths={viewedPaths}
					/>
				)}
			</DialogContent>
		</Dialog>
	)
}

interface PullRequestJumpPanelProps
	extends Required<Pick<PullRequestJumpToFileProps, 'mode' | 'files'>> {
	viewedPaths?: ReadonlySet<string>
	diffInput: Omit<GetPullRequestFileDiffInput, 'path'>
	onSelect: (match: PullRequestDiffMatch) => void
}

function PullRequestJumpPanel({
	mode,
	files,
	viewedPaths,
	diffInput,
	onSelect,
}: Readonly<PullRequestJumpPanelProps>) {
	// Only read once the palette is up, so a closed one costs a page nothing.
	const queryClient = useQueryClient()
	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const isFind = mode === 'find'
	const { results, unsearchedCount } = isFind
		? searchLoadedDiffs(queryClient, files, diffInput, query)
		: { results: filterFiles(files, query), unsearchedCount: 0 }
	const activeOption = Math.min(activeIndex, Math.max(results.length - 1, 0))
	const active = results[activeOption]

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const delta = event.key === 'ArrowDown' ? 1 : -1

			event.preventDefault()
			setActiveIndex(index =>
				Math.min(Math.max(index + delta, 0), Math.max(results.length - 1, 0))
			)

			return
		}

		if (event.key === 'Enter' && active) {
			event.preventDefault()
			onSelect(active)
		}
	}

	return (
		<>
			<DialogHeader className="px-4 pt-4">
				<DialogTitle className="text-base">
					{isFind ? 'Find in this diff' : 'Jump to a file'}
				</DialogTitle>
				<DialogDescription className="text-xs">
					{isFind
						? 'Searches file paths and the diffs already loaded on this page.'
						: 'Filter the changed files by path.'}
				</DialogDescription>
			</DialogHeader>
			<div className="px-4">
				<Input
					aria-activedescendant={
						active ? `${OPTION_ID_PREFIX}-${activeOption}` : undefined
					}
					aria-controls="pull-request-jump-results"
					aria-expanded
					aria-label={isFind ? 'Search this diff' : 'Filter files'}
					autoFocus
					onChange={event => {
						setQuery(event.target.value)
						setActiveIndex(0)
					}}
					onKeyDown={handleKeyDown}
					placeholder={isFind ? 'Search lines and paths' : 'Filter by path'}
					role="combobox"
					value={query}
				/>
			</div>
			<div
				className="max-h-[50vh] overflow-y-auto px-2 pb-2"
				id="pull-request-jump-results"
				role="listbox"
			>
				{results.map((result, index) => (
					<button
						aria-selected={index === activeOption}
						className={cn(
							'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left',
							index === activeOption ? 'bg-secondary' : 'hover:bg-secondary/60'
						)}
						id={`${OPTION_ID_PREFIX}-${index}`}
						key={result.key}
						onClick={() => onSelect(result)}
						onPointerEnter={() => setActiveIndex(index)}
						role="option"
						type="button"
					>
						<span
							aria-hidden
							className={cn(
								'flex size-3.5 shrink-0 items-center justify-center rounded-xs font-mono text-[0.625rem] leading-none',
								FILE_STATUS_CLASSES[result.file.status]
							)}
						>
							{FILE_STATUS_LETTERS[result.file.status]}
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<span
								className={cn(
									'truncate font-mono text-xs',
									viewedPaths?.has(result.path) && 'text-muted-foreground'
								)}
							>
								{result.path}
								{result.line !== undefined && (
									<span className="text-muted-foreground"> :{result.line}</span>
								)}
							</span>
							{result.preview && (
								<span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
									{result.preview}
								</span>
							)}
						</span>
						<PullRequestDiffStatsBadge
							additions={result.file.additions}
							deletions={result.file.deletions}
						/>
					</button>
				))}
				{results.length === 0 && (
					<p className="px-2 py-3 text-muted-foreground text-xs">
						{isFind && query.length < MIN_FIND_LENGTH
							? `Type at least ${MIN_FIND_LENGTH} characters.`
							: 'No matches.'}
					</p>
				)}
			</div>
			{unsearchedCount > 0 && (
				<p className="border-border border-t px-4 py-2 text-muted-foreground text-xs">
					{unsearchedCount} {unsearchedCount === 1 ? 'file was' : 'files were'}{' '}
					not searched — open them to include their contents.
				</p>
			)}
		</>
	)
}

function filterFiles(
	files: readonly PullRequestChangedFile[],
	query: string
): PullRequestJumpResult[] {
	const needle = query.trim().toLowerCase()

	return files
		.flatMap(file => {
			const path = getChangedFilePath(file)

			if (needle && !path.toLowerCase().includes(needle)) return []

			return [{ key: path, path, file }]
		})
		.slice(0, MAX_RESULTS)
}

function toLineResults(
	file: PullRequestChangedFile,
	path: string,
	diff: PullRequestFileDiff,
	needle: string
): PullRequestJumpResult[] {
	return diff.hunks.flatMap(hunk =>
		hunk.lines.flatMap(line => {
			const anchor = line.new ?? line.old

			if (!(anchor && line.content.toLowerCase().includes(needle))) return []

			return [
				{
					key: `${path}:${anchor.side}:${anchor.line}`,
					path,
					side: anchor.side,
					line: anchor.line,
					preview: line.content.trim().slice(0, PREVIEW_LENGTH),
					file,
				},
			]
		})
	)
}

function searchLoadedDiffs(
	queryClient: QueryClient,
	files: readonly PullRequestChangedFile[],
	diffInput: Omit<GetPullRequestFileDiffInput, 'path'>,
	query: string
) {
	const needle = query.trim().toLowerCase()

	if (needle.length < MIN_FIND_LENGTH)
		return { results: [] as PullRequestJumpResult[], unsearchedCount: 0 }

	const results: PullRequestJumpResult[] = []
	let unsearchedCount = 0

	for (const file of files) {
		const path = getChangedFilePath(file)

		if (path.toLowerCase().includes(needle))
			results.push({ key: `path:${path}`, path, file })

		const diff = queryClient.getQueryData(
			getPullRequestFileDiffQueryOptions({ ...diffInput, path }).queryKey
		)

		if (diff) results.push(...toLineResults(file, path, diff, needle))
		else unsearchedCount += 1

		if (results.length >= MAX_RESULTS) break
	}

	return { results: results.slice(0, MAX_RESULTS), unsearchedCount }
}
