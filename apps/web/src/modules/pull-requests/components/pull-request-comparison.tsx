import type {
	PullRequestChangedFile,
	PullRequestComparison as PullRequestComparisonData,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { ChevronRight, FileCode2, GitCommitHorizontal } from 'lucide-react'
import { useState } from 'react'
import {
	getInlineThreadsForFile,
	getUnanchoredInlineThreads,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestReviewContext } from '../helpers/pull-request-review'
import { getPullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestChecksStatusDot } from './pull-request-checks-status-dot'
import { PullRequestFileDiffView } from './pull-request-file-diff'
import { PullRequestOutdatedThreads } from './pull-request-file-threads'
import { PullRequestsMessage } from './pull-requests-message'

type PullRequestDetailTab = 'overview' | 'commits' | 'files'

interface PullRequestComparisonProps {
	username: string
	slug: string
	number: string
	tab: PullRequestDetailTab
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
}

export function PullRequestComparison({
	username,
	slug,
	number,
	tab,
	review,
	viewerUserId,
}: Readonly<PullRequestComparisonProps>) {
	const comparisonQuery = usePullRequestComparisonQuery(
		{ username, slug, number },
		tab !== 'overview'
	)

	if (tab === 'overview') return null

	if (comparisonQuery.isLoading) return <ComparisonLoadingState />

	if (comparisonQuery.isError)
		return (
			<PullRequestsMessage
				description="The repository comparison could not be loaded."
				title="Comparison unavailable"
			/>
		)

	if (!comparisonQuery.data)
		return (
			<PullRequestsMessage
				description="The comparison returned no data."
				title="Comparison unavailable"
			/>
		)

	if (tab === 'commits')
		return <PullRequestCommits comparison={comparisonQuery.data} />

	return (
		<PullRequestFiles
			comparison={comparisonQuery.data}
			number={number}
			review={review}
			slug={slug}
			username={username}
			viewerUserId={viewerUserId}
		/>
	)
}

function ComparisonLoadingState() {
	return (
		<Card className="gap-3">
			<div className="h-5 w-40 animate-pulse rounded bg-muted" />
			<div className="h-20 animate-pulse rounded bg-muted/70" />
		</Card>
	)
}

interface PullRequestCommitsProps {
	comparison: PullRequestComparisonData
}

function PullRequestCommits({ comparison }: Readonly<PullRequestCommitsProps>) {
	if (comparison.commits.length === 0)
		return (
			<PullRequestsMessage
				description="The source branch has no commits beyond the merge base."
				title="No commits to show"
			/>
		)

	return (
		<div className="flex flex-col gap-3">
			{comparison.commitsTruncated && (
				<PullRequestsMessage
					description={`Only the first ${comparison.commitLimit} commits are shown.`}
					title="Commit list truncated"
				/>
			)}
			<Card className="gap-0 p-0">
				<ul className="divide-y divide-border">
					{comparison.commits.map(commit => (
						<li className="flex items-start gap-3 px-4 py-3" key={commit.sha}>
							<GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">{commit.summary}</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{commit.author?.name ?? 'Unknown author'}
								</p>
							</div>
							<PullRequestChecksStatusDot summary={commit.checksSummary} />
							<code className="rounded bg-muted px-2 py-1 text-xs">
								{commit.shortSha}
							</code>
						</li>
					))}
				</ul>
			</Card>
		</div>
	)
}

interface PullRequestFilesProps {
	comparison: PullRequestComparisonData
	username: string
	slug: string
	number: string
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
}

function PullRequestFiles({
	comparison,
	username,
	slug,
	number,
	review,
	viewerUserId,
}: Readonly<PullRequestFilesProps>) {
	const [expandedPaths, setExpandedPaths] = useState<string[]>([])
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	const threads = threadsQuery.data?.threads ?? []
	const permissions = getPullRequestThreadPermissions({
		viewer: threadsQuery.data?.viewer,
		viewerUserId,
		review: review && { ...review, headSha: comparison.headSha },
	})
	const unanchoredThreads = getUnanchoredInlineThreads(
		threads,
		comparison.files
	)

	if (comparison.files.length === 0)
		return (
			<div className="flex flex-col gap-3">
				<PullRequestsMessage
					description="The source and target branches contain the same files."
					title="No changed files"
				/>
				{unanchoredThreads.length > 0 && (
					<Card className="gap-0 overflow-hidden p-0">
						<PullRequestOutdatedThreads
							number={number}
							permissions={permissions}
							slug={slug}
							threads={unanchoredThreads}
							title="Outdated discussions"
							username={username}
						/>
					</Card>
				)}
			</div>
		)

	function togglePath(path: string) {
		setExpandedPaths(paths =>
			paths.includes(path)
				? paths.filter(expandedPath => expandedPath !== path)
				: [...paths, path]
		)
	}

	return (
		<div className="flex flex-col gap-3">
			{comparison.isTruncated && (
				<PullRequestsMessage
					description={`Only the first ${comparison.fileLimit} changed files are shown.`}
					title="File list truncated"
				/>
			)}
			{threadsQuery.isError && (
				<p className="text-destructive text-sm" role="alert">
					The comments for these files could not be loaded.
				</p>
			)}
			{comparison.files.map(file => {
				const path = file.newPath || file.oldPath
				const displayPath =
					file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : path
				const isExpanded = expandedPaths.includes(path)

				return (
					<Card
						className="gap-0 overflow-hidden p-0"
						key={`${file.oldPath}:${file.newPath}`}
					>
						<Button
							aria-expanded={isExpanded}
							className="h-auto w-full justify-start rounded-none px-4 py-3 text-left"
							onClick={() => togglePath(path)}
							variant="ghost"
						>
							<ChevronRight
								className={cn(
									'size-4 shrink-0 transition-transform',
									isExpanded && 'rotate-90'
								)}
							/>
							<FileCode2 className="size-4 shrink-0 text-muted-foreground" />
							<span
								className="min-w-0 flex-1 truncate font-mono text-xs"
								title={displayPath}
							>
								{displayPath}
							</span>
							<FileStats file={file} />
						</Button>
						{isExpanded && (
							<PullRequestFileDiffView
								expectedBaseSha={comparison.baseSha}
								expectedHeadSha={comparison.headSha}
								number={number}
								path={path}
								permissions={permissions}
								slug={slug}
								threads={getInlineThreadsForFile(
									threads,
									file,
									comparison.files
								)}
								username={username}
							/>
						)}
					</Card>
				)
			})}
			{unanchoredThreads.length > 0 && (
				<Card className="gap-0 overflow-hidden p-0">
					<PullRequestOutdatedThreads
						number={number}
						permissions={permissions}
						slug={slug}
						threads={unanchoredThreads}
						title="Outdated discussions"
						username={username}
					/>
				</Card>
			)}
		</div>
	)
}

function FileStats({ file }: Readonly<{ file: PullRequestChangedFile }>) {
	return (
		<span className="flex shrink-0 items-center gap-2 text-xs">
			<span className="text-muted-foreground capitalize">{file.status}</span>
			<span className="text-emerald-400">+{file.additions}</span>
			<span className="text-red-400">−{file.deletions}</span>
		</span>
	)
}
