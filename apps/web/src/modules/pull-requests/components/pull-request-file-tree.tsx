import type {
	PullRequestChangedFile,
	PullRequestChangedFileStatus,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { cn } from '@repo/ui/utils'
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useState } from 'react'
import {
	buildPullRequestFileTree,
	flattenPullRequestFileTree,
} from '../helpers/pull-request-changed-files'

const FILE_STATUS_LETTERS = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
} as const satisfies Record<PullRequestChangedFileStatus, string>

const FILE_STATUS_CLASSES = {
	added: 'text-emerald-400',
	deleted: 'text-red-400',
	modified: 'text-amber-400',
	renamed: 'text-sky-400',
} as const satisfies Record<PullRequestChangedFileStatus, string>

const ROW_CLASSES =
	'h-[26px] w-full justify-start gap-1.5 rounded-sm px-1.5 py-0 text-left font-normal [&_svg]:size-3'

interface PullRequestFileTreeProps {
	files: readonly PullRequestChangedFile[]
	/** Absent where the viewed state is unknown, so no row may claim to be ticked. */
	viewedPaths?: ReadonlySet<string>
	activePath?: string
	onSelect: (path: string) => void
	onPrefetch: (file: PullRequestChangedFile) => void
}

export function PullRequestFileTree({
	files,
	viewedPaths,
	activePath,
	onSelect,
	onPrefetch,
}: Readonly<PullRequestFileTreeProps>) {
	const [collapsedDirectories, setCollapsedDirectories] = useState<string[]>([])

	const rows = flattenPullRequestFileTree(
		buildPullRequestFileTree(files),
		collapsedDirectories
	)
	function toggleDirectory(path: string) {
		setCollapsedDirectories(directories =>
			directories.includes(path)
				? directories.filter(directory => directory !== path)
				: [...directories, path]
		)
	}

	return (
		<div className="rounded-md border border-border bg-card p-1">
			<ul className="flex max-h-[calc(100vh-8rem)] flex-col overflow-y-auto">
				{rows.map(({ depth, node }) => (
					<li
						key={node.path}
						style={{ paddingInlineStart: `${depth * 0.75}rem` }}
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
								isViewed={viewedPaths?.has(node.path) ?? false}
								name={node.name}
								onPrefetch={() => onPrefetch(node.file)}
								onSelect={() => onSelect(node.path)}
								path={node.path}
							/>
						)}
					</li>
				))}
			</ul>
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
			className={ROW_CLASSES}
			onClick={onToggle}
			variant="ghost"
		>
			<Chevron className="size-3 shrink-0 text-muted-foreground" />
			<Folder className="size-3 shrink-0 text-muted-foreground" />
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
	onSelect: () => void
	onPrefetch: () => void
}

function FileRow({
	file,
	name,
	path,
	isActive,
	isViewed,
	onSelect,
	onPrefetch,
}: Readonly<FileRowProps>) {
	return (
		<Button
			aria-current={isActive ? 'true' : undefined}
			className={cn(
				ROW_CLASSES,
				isActive && 'bg-muted',
				isViewed && 'opacity-60'
			)}
			onClick={onSelect}
			onFocus={onPrefetch}
			onPointerEnter={onPrefetch}
			variant="ghost"
		>
			<span
				className={cn(
					'w-3 shrink-0 text-center font-mono text-[0.625rem]',
					FILE_STATUS_CLASSES[file.status]
				)}
			>
				<span aria-hidden="true">{FILE_STATUS_LETTERS[file.status]}</span>
				<span className="sr-only">{file.status}</span>
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
				{name}
			</span>
			<span className="shrink-0 text-[0.625rem] text-emerald-400/70 tabular-nums">
				+{file.additions}
			</span>
			<span className="shrink-0 text-[0.625rem] text-red-400/70 tabular-nums">
				−{file.deletions}
			</span>
			{isViewed && <Check className="size-3 shrink-0 text-muted-foreground" />}
		</Button>
	)
}
