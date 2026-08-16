import type {
	PullRequestChangedFile,
	PullRequestComparison as PullRequestComparisonData,
	PullRequestThreadSide,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { ChevronRight, FileCode2 } from 'lucide-react'
import { useState } from 'react'
import {
	getInlineThreadsForFile,
	getUnanchoredInlineThreads,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestReviewContext } from '../helpers/pull-request-review'
import { getPullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import {
	type PullRequestDiffAnchorComparison,
	PullRequestFileDiffView,
} from './pull-request-file-diff'
import { PullRequestOutdatedThreads } from './pull-request-file-threads'
import { PullRequestsMessage } from './pull-requests-message'

const ANCHORABLE_DIFF_SIDES = [
	'left',
	'right',
] as const satisfies readonly PullRequestThreadSide[]

/**
 * A left-side line of a since-review comparison is numbered against the merge
 * base of the two heads, which is not the pull request's own merge base. A
 * thread neither belongs on such a line nor may be opened from one, because
 * the same number means a different line in the full diff.
 */
const RIGHT_ANCHORABLE_DIFF_SIDES = [
	'right',
] as const satisfies readonly PullRequestThreadSide[]

interface PullRequestComparisonFilesProps {
	comparison: PullRequestComparisonData
	/**
	 * The pair every thread opened here is stored against. It is the displayed
	 * comparison in the full diff, and the pull request's own comparison while
	 * reading the changes since a review — a thread stored against the review
	 * pair would be outdated the moment it was written.
	 */
	anchorComparison: PullRequestDiffAnchorComparison
	/**
	 * Whether only the changes since a review are on screen. The rest of the pull
	 * request is then absent by design: its files are not missing, its threads are
	 * not outdated, and its left-side lines cannot be anchored to.
	 */
	isSinceReview?: boolean
	username: string
	slug: string
	number: string
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
	isGitHubAuthoritative: boolean
}

export function PullRequestComparisonFiles({
	comparison,
	anchorComparison,
	isSinceReview = false,
	username,
	slug,
	number,
	review,
	viewerUserId,
	isGitHubAuthoritative,
}: Readonly<PullRequestComparisonFilesProps>) {
	const [expandedPaths, setExpandedPaths] = useState<string[]>([])
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	const threads = threadsQuery.data?.threads ?? []
	const permissions = getPullRequestThreadPermissions({
		viewer: threadsQuery.data?.viewer,
		viewerUserId,
		isGitHubAuthoritative,
		review: review && { ...review, headSha: comparison.headSha },
	})
	const unanchoredThreads = getUnanchoredInlineThreads(
		threads,
		comparison.files
	)
	const anchorableSides = isSinceReview
		? RIGHT_ANCHORABLE_DIFF_SIDES
		: ANCHORABLE_DIFF_SIDES
	const unanchoredThreadsTitle = isSinceReview
		? 'Comments on files these commits leave untouched'
		: 'Outdated discussions'

	if (comparison.files.length === 0)
		return (
			<div className="flex flex-col gap-3">
				<PullRequestsMessage
					description={
						isSinceReview
							? 'These commits changed no files, only history.'
							: 'The source and target branches contain the same files.'
					}
					title="No changed files"
				/>
				{unanchoredThreads.length > 0 && (
					<Card className="gap-0 overflow-hidden p-0">
						<PullRequestOutdatedThreads
							number={number}
							permissions={permissions}
							slug={slug}
							threads={unanchoredThreads}
							title={unanchoredThreadsTitle}
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
			{permissions.canComment && isSinceReview && (
				<p className="text-muted-foreground text-sm">
					Comments on already-reviewed lines are available in the full diff.
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
								anchorableSides={anchorableSides}
								anchorComparison={anchorComparison}
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
						title={unanchoredThreadsTitle}
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
