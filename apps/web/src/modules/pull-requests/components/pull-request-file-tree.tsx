import type {
	PullRequestChangedFile,
	PullRequestChangedFileStatus,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { cn } from '@repo/ui/utils'
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useRef, useState, useSyncExternalStore } from 'react'
import {
	buildPullRequestFileTree,
	flattenPullRequestFileTree,
	getChangedFilePath,
} from '../helpers/pull-request-changed-files'

const FILE_STATUS_LETTERS = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
} as const satisfies Record<PullRequestChangedFileStatus, string>

const FILE_STATUS_CLASSES = {
	added: 'bg-diff-add-marker text-background',
	deleted: 'bg-diff-del-marker text-background',
	modified: 'bg-primary text-primary-foreground',
	renamed: 'bg-diff-hunk-action text-background',
} as const satisfies Record<PullRequestChangedFileStatus, string>

const ROW_CLASSES =
	'h-6 w-full justify-start gap-1.5 rounded-sm px-1.5 py-0 text-left font-normal [&_svg]:size-3'

const DIFF_BAR_KEYS = ['one', 'two', 'three', 'four', 'five'] as const
const DIFF_BAR_CELLS = DIFF_BAR_KEYS.length
const DIFF_BAR_TONE_CLASSES = {
	addition: 'bg-diff-add-marker',
	deletion: 'bg-diff-del-marker',
	neutral: 'bg-border',
} as const

export const PULL_REQUEST_TREE_MIN_WIDTH = 240
export const PULL_REQUEST_TREE_MAX_WIDTH = 420

const TREE_OPEN_STORAGE_KEY = 'detent.pull-request-file-tree.open'
const TREE_WIDTH_STORAGE_KEY = 'detent.pull-request-file-tree.width'
const TREE_DEFAULT_WIDTH = 260
// Below this the tree costs more columns than it saves scrolling.
const TREE_AUTO_OPEN_VIEWPORT = 1600
const TREE_KEYBOARD_STEP = 16

const treeListeners = new Set<() => void>()
let openSnapshot: boolean | undefined
let widthSnapshot: number | undefined

function readStored(key: string) {
	try {
		return window.localStorage.getItem(key)
	} catch {
		return null
	}
}

function writeStored(key: string, value: string) {
	try {
		window.localStorage.setItem(key, value)
	} catch {
		// A browser that refuses storage still gets the session's choice.
	}
}

function emitTreeChange() {
	for (const listener of treeListeners) listener()
}

function subscribeToTree(listener: () => void) {
	treeListeners.add(listener)

	return () => {
		treeListeners.delete(listener)
	}
}

function getTreeOpenSnapshot() {
	if (openSnapshot === undefined) {
		const stored = readStored(TREE_OPEN_STORAGE_KEY)

		openSnapshot =
			stored === null
				? window.innerWidth >= TREE_AUTO_OPEN_VIEWPORT
				: stored === 'true'
	}

	return openSnapshot
}

function getTreeWidthSnapshot() {
	if (widthSnapshot === undefined) {
		const stored = Number(readStored(TREE_WIDTH_STORAGE_KEY))

		widthSnapshot = clampTreeWidth(stored > 0 ? stored : TREE_DEFAULT_WIDTH)
	}

	return widthSnapshot
}

function getServerTreeOpen() {
	return false
}

function getServerTreeWidth() {
	return TREE_DEFAULT_WIDTH
}

function clampTreeWidth(width: number) {
	return Math.min(
		PULL_REQUEST_TREE_MAX_WIDTH,
		Math.max(PULL_REQUEST_TREE_MIN_WIDTH, Math.round(width))
	)
}

export function setPullRequestTreeOpen(isOpen: boolean) {
	openSnapshot = isOpen
	writeStored(TREE_OPEN_STORAGE_KEY, String(isOpen))
	emitTreeChange()
}

function setPullRequestTreeWidth(width: number, shouldPersist: boolean) {
	widthSnapshot = clampTreeWidth(width)

	if (shouldPersist) writeStored(TREE_WIDTH_STORAGE_KEY, String(widthSnapshot))

	emitTreeChange()
}

/** Tree geometry outlives the route, so it lives outside React and syncs in. */
export function usePullRequestFileTreeLayout() {
	const isOpen = useSyncExternalStore(
		subscribeToTree,
		getTreeOpenSnapshot,
		getServerTreeOpen
	)
	const width = useSyncExternalStore(
		subscribeToTree,
		getTreeWidthSnapshot,
		getServerTreeWidth
	)

	return { isOpen, width }
}

interface PullRequestFileTreeProps {
	files: readonly PullRequestChangedFile[]
	/** Absent where the viewed state is unknown, so no row may claim to be ticked. */
	viewedPaths?: ReadonlySet<string>
	/** Files the head moved on after the reader's own last submitted review. */
	changedSincePaths?: ReadonlySet<string>
	activePath?: string
	/** Absent where the tree is a disclosure rather than a resizable column. */
	isResizable?: boolean
	onSelect: (path: string) => void
	onPrefetch: (file: PullRequestChangedFile) => void
}

export function PullRequestFileTree({
	files,
	viewedPaths,
	changedSincePaths,
	activePath,
	isResizable = false,
	onSelect,
	onPrefetch,
}: Readonly<PullRequestFileTreeProps>) {
	const [collapsedDirectories, setCollapsedDirectories] = useState<string[]>([])
	const [filter, setFilter] = useState('')
	const { width } = usePullRequestFileTreeLayout()
	const dragOrigin = useRef<{ clientX: number; width: number }>(undefined)

	const query = filter.trim().toLowerCase()
	const matchedFiles = query
		? files.filter(file =>
				getChangedFilePath(file).toLowerCase().includes(query)
			)
		: files
	const rows = flattenPullRequestFileTree(
		buildPullRequestFileTree(matchedFiles),
		collapsedDirectories
	)
	const viewedCount = viewedPaths
		? files.filter(file => viewedPaths.has(getChangedFilePath(file))).length
		: undefined

	function toggleDirectory(path: string) {
		setCollapsedDirectories(directories =>
			directories.includes(path)
				? directories.filter(directory => directory !== path)
				: [...directories, path]
		)
	}

	function resizeFromPointer(clientX: number, shouldPersist: boolean) {
		const origin = dragOrigin.current

		if (!origin) return

		setPullRequestTreeWidth(
			origin.width + clientX - origin.clientX,
			shouldPersist
		)
	}

	return (
		<div className="relative flex h-full flex-col rounded-md border border-border bg-card">
			<div className="flex flex-col gap-1 border-border border-b p-1.5">
				<Input
					aria-label="Filter files"
					className="h-6 rounded-sm px-1.5 font-mono text-xs"
					onChange={event => setFilter(event.target.value)}
					placeholder="Filter files"
					value={filter}
				/>
				<p className="px-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
					{viewedCount === undefined
						? `${matchedFiles.length} of ${files.length} files`
						: `${viewedCount} / ${files.length} viewed`}
				</p>
			</div>
			<ul className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
				{rows.map(({ depth, node }) => (
					<li
						key={node.path}
						style={{ paddingInlineStart: `${depth * 0.625}rem` }}
					>
						{node.kind === 'directory' ? (
							<DirectoryRow
								isCollapsed={collapsedDirectories.includes(node.path)}
								name={node.name}
								onToggle={() => toggleDirectory(node.path)}
							/>
						) : (
							<FileRow
								file={node.file}
								isActive={node.path === activePath}
								isChangedSinceReview={
									changedSincePaths?.has(node.path) ?? false
								}
								isViewed={viewedPaths?.has(node.path) ?? false}
								name={node.name}
								onPrefetch={() => onPrefetch(node.file)}
								onSelect={() => onSelect(node.path)}
								path={node.path}
							/>
						)}
					</li>
				))}
				{rows.length === 0 && (
					<li className="px-1.5 py-2 text-muted-foreground text-xs">
						No file matches “{filter.trim()}”.
					</li>
				)}
			</ul>
			{isResizable && (
				<hr
					aria-label="Resize the file tree"
					aria-orientation="vertical"
					aria-valuemax={PULL_REQUEST_TREE_MAX_WIDTH}
					aria-valuemin={PULL_REQUEST_TREE_MIN_WIDTH}
					aria-valuenow={width}
					className="absolute inset-y-0 -right-2.5 my-0 hidden h-auto w-2 cursor-col-resize rounded-full border-0 bg-transparent hover:bg-border focus-visible:bg-border focus-visible:outline-hidden lg:block"
					onKeyDown={event => {
						if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

						event.preventDefault()
						setPullRequestTreeWidth(
							width +
								(event.key === 'ArrowRight'
									? TREE_KEYBOARD_STEP
									: -TREE_KEYBOARD_STEP),
							true
						)
					}}
					onLostPointerCapture={() => {
						dragOrigin.current = undefined
					}}
					onPointerDown={event => {
						dragOrigin.current = { clientX: event.clientX, width }
						event.currentTarget.setPointerCapture(event.pointerId)
					}}
					onPointerMove={event => resizeFromPointer(event.clientX, false)}
					onPointerUp={event => {
						resizeFromPointer(event.clientX, true)
						dragOrigin.current = undefined
					}}
					tabIndex={0}
				/>
			)}
		</div>
	)
}

interface DirectoryRowProps {
	name: string
	isCollapsed: boolean
	onToggle: () => void
}

function DirectoryRow({
	name,
	isCollapsed,
	onToggle,
}: Readonly<DirectoryRowProps>) {
	const Chevron = isCollapsed ? ChevronRight : ChevronDown

	return (
		<Button
			aria-expanded={!isCollapsed}
			className={cn(ROW_CLASSES, 'text-muted-foreground')}
			onClick={onToggle}
			variant="ghost"
		>
			<Chevron className="size-3 shrink-0" />
			<Folder className="size-3 shrink-0" />
			<span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
		</Button>
	)
}

interface FileRowProps {
	file: PullRequestChangedFile
	name: string
	path: string
	isActive: boolean
	isViewed: boolean
	isChangedSinceReview: boolean
	onSelect: () => void
	onPrefetch: () => void
}

function FileRow({
	file,
	name,
	path,
	isActive,
	isViewed,
	isChangedSinceReview,
	onSelect,
	onPrefetch,
}: Readonly<FileRowProps>) {
	return (
		<Button
			aria-current={isActive ? 'true' : undefined}
			className={cn(
				ROW_CLASSES,
				'text-foreground',
				isActive &&
					'bg-diff-row-hover shadow-[inset_2px_0_0_0_var(--primary)] transition-shadow duration-[120ms]',
				isViewed && 'text-diff-viewed-fg'
			)}
			onClick={onSelect}
			onFocus={onPrefetch}
			onPointerEnter={onPrefetch}
			variant="ghost"
		>
			<span
				className={cn(
					'flex size-3.5 shrink-0 items-center justify-center rounded-xs font-mono text-[0.625rem] leading-none',
					FILE_STATUS_CLASSES[file.status]
				)}
			>
				<span aria-hidden="true">{FILE_STATUS_LETTERS[file.status]}</span>
				<span className="sr-only">{file.status}</span>
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
				{name}
			</span>
			{isChangedSinceReview && (
				<span
					className="size-1.5 shrink-0 rounded-full bg-diff-comment-edge"
					title="Changed since your last review"
				>
					<span className="sr-only">changed since your last review</span>
				</span>
			)}
			<DiffBar additions={file.additions} deletions={file.deletions} />
			{isViewed && <Check className="size-3 shrink-0" />}
		</Button>
	)
}

function getAddedDiffBarCells(additions: number, deletions: number) {
	if (additions === 0) return 0
	if (deletions === 0) return DIFF_BAR_CELLS

	return Math.min(
		DIFF_BAR_CELLS - 1,
		Math.max(
			1,
			Math.round((additions / (additions + deletions)) * DIFF_BAR_CELLS)
		)
	)
}

/** Five cells read pre-attentively where `+13 −56` has to be parsed. */
function DiffBar({
	additions,
	deletions,
}: Readonly<{ additions: number; deletions: number }>) {
	const total = additions + deletions
	const added = getAddedDiffBarCells(additions, deletions)
	const deleted = total === 0 ? 0 : DIFF_BAR_CELLS - added

	return (
		<span
			aria-hidden
			className="flex shrink-0 gap-px"
			title={`+${additions} −${deletions}`}
		>
			{DIFF_BAR_KEYS.map((key, index) => {
				const tone =
					index < added
						? 'addition'
						: index < added + deleted
							? 'deletion'
							: 'neutral'

				return (
					<span
						className={cn('h-1.5 w-1 rounded-xs', DIFF_BAR_TONE_CLASSES[tone])}
						key={key}
					/>
				)
			})}
		</span>
	)
}
