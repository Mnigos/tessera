import type {
	PullRequestChangedFile,
	PullRequestComparison as PullRequestComparisonData,
	PullRequestThread,
	PullRequestThreadSide,
	SessionUser,
} from '@repo/contracts'
import { useReducedMotion } from 'motion/react'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { isPullRequestStaleComparisonError } from '../helpers/get-pull-request-error-message'
import {
	getChangedFilePath,
	isLargeChangedFile,
} from '../helpers/pull-request-changed-files'
import {
	getInlineThreadsForFile,
	getUnanchoredInlineThreads,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestReviewContext } from '../helpers/pull-request-review'
import { getPullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { usePrefetchPullRequestFileDiff } from '../hooks/use-prefetch-pull-request-file-diff'
import { usePullRequestFileSections } from '../hooks/use-pull-request-file-sections'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { usePullRequestViewedFilesQuery } from '../hooks/use-pull-request-viewed-files.query'
import { useSetPullRequestFileViewedMutation } from '../hooks/use-set-pull-request-file-viewed.mutation'
import {
	type PullRequestDiffAnchorComparison,
	PullRequestFileDiffView,
} from './pull-request-file-diff'
import { PullRequestFileSection } from './pull-request-file-section'
import { PullRequestOutdatedThreads } from './pull-request-file-threads'
import { PullRequestFileTree } from './pull-request-file-tree'
import { PullRequestsMessage } from './pull-requests-message'

const ANCHORABLE_DIFF_SIDES = [
	'left',
	'right',
] as const satisfies readonly PullRequestThreadSide[]

const NO_THREADS: PullRequestThread[] = []

// A since-review left line is numbered against another merge base entirely.
const RIGHT_ANCHORABLE_DIFF_SIDES = [
	'right',
] as const satisfies readonly PullRequestThreadSide[]

interface PullRequestComparisonFilesProps {
	comparison: PullRequestComparisonData
	/** The pull request's own pair, which a since-review comparison is not. */
	anchorComparison: PullRequestDiffAnchorComparison
	isSinceReview?: boolean
	username: string
	slug: string
	number: string
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
	isGitHubAuthoritative: boolean
	/** The review trigger, which shares the toolbar row with the viewed counter. */
	toolbarAction?: ReactNode
	/** The comparison switch, which leads the toolbar row before the counter. */
	toolbarLead?: ReactNode
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
	toolbarAction,
	toolbarLead,
}: Readonly<PullRequestComparisonFilesProps>) {
	const prefetchFileDiff = usePrefetchPullRequestFileDiff()
	const shouldReduceMotion = useReducedMotion()
	const {
		activePath,
		clearExpanded,
		expansionOverrides,
		nearViewportPaths,
		registerSectionNode,
		reset,
		scrollToSection,
		setExpanded,
	} = usePullRequestFileSections()
	const [pendingViewedPaths, setPendingViewedPaths] = useState<string[]>([])
	const inFlightViewedPaths = useRef(new Set<string>())
	const { baseSha: anchorBaseSha, headSha: anchorHeadSha } = anchorComparison
	const diffAnchorComparison = useMemo(
		() => ({ baseSha: anchorBaseSha, headSha: anchorHeadSha }),
		[anchorBaseSha, anchorHeadSha]
	)
	const comparisonPair = `${comparison.baseSha}:${comparison.headSha}`
	const [renderedPair, setRenderedPair] = useState(comparisonPair)

	// Reset per-pair UI state in place; remounting would drop a comment being written.
	if (renderedPair !== comparisonPair) {
		setRenderedPair(comparisonPair)
		setPendingViewedPaths([])
		reset()
	}

	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })
	// A since-review tick would speak for a diff read against another pair.
	const canMarkViewed = Boolean(viewerUserId) && !isSinceReview
	const viewedFilesQuery = usePullRequestViewedFilesQuery(
		{ username, slug, number, expectedHeadSha: comparison.headSha },
		canMarkViewed
	)
	const setFileViewedMutation = useSetPullRequestFileViewedMutation()

	const threads = threadsQuery.data?.threads ?? NO_THREADS
	const viewer = threadsQuery.data?.viewer
	const permissions = useMemo(
		() =>
			getPullRequestThreadPermissions({
				viewer,
				viewerUserId,
				isGitHubAuthoritative,
				review: review && { ...review, headSha: comparison.headSha },
			}),
		[comparison.headSha, isGitHubAuthoritative, review, viewer, viewerUserId]
	)
	const unanchoredThreads = getUnanchoredInlineThreads(
		threads,
		comparison.files
	)
	const isViewedStateKnown = canMarkViewed && viewedFilesQuery.isSuccess
	const viewedPaths = isViewedStateKnown
		? new Set(viewedFilesQuery.data?.paths ?? [])
		: undefined
	const anchorableSides = isSinceReview
		? RIGHT_ANCHORABLE_DIFF_SIDES
		: ANCHORABLE_DIFF_SIDES
	const viewedCount = comparison.files.filter(file =>
		viewedPaths?.has(getChangedFilePath(file))
	).length

	const setFileViewed = setFileViewedMutation.mutate
	const toggleViewed = useCallback(
		(path: string, viewed: boolean) => {
			if (inFlightViewedPaths.current.has(path)) return

			inFlightViewedPaths.current.add(path)
			setPendingViewedPaths(paths => [...paths, path])
			setExpanded(path, !viewed)
			setFileViewed(
				{
					username,
					slug,
					number,
					expectedHeadSha: comparison.headSha,
					path,
					viewed,
				},
				{
					onError: () => clearExpanded(path),
					onSettled: () => {
						inFlightViewedPaths.current.delete(path)
						setPendingViewedPaths(paths =>
							paths.filter(pendingPath => pendingPath !== path)
						)
					},
				}
			)
		},
		[
			clearExpanded,
			comparison.headSha,
			number,
			setExpanded,
			setFileViewed,
			slug,
			username,
		]
	)

	// A file kept behind `Load diff` is the one not worth fetching on a passing pointer.
	const prefetchFile = useCallback(
		(file: PullRequestChangedFile) => {
			if (isLargeChangedFile(file)) return

			prefetchFileDiff({
				username,
				slug,
				number,
				path: getChangedFilePath(file),
				expectedBaseSha: comparison.baseSha,
				expectedHeadSha: comparison.headSha,
			})
		},
		[
			comparison.baseSha,
			comparison.headSha,
			number,
			prefetchFileDiff,
			slug,
			username,
		]
	)
	// Stable elements keep a viewed tick from re-rendering all the other diffs.
	const fileDiffViews = useMemo(
		() =>
			new Map(
				comparison.files.map(file => {
					const path = getChangedFilePath(file)

					return [
						path,
						<PullRequestFileDiffView
							anchorableSides={anchorableSides}
							anchorComparison={diffAnchorComparison}
							expectedBaseSha={comparison.baseSha}
							expectedHeadSha={comparison.headSha}
							key={path}
							number={number}
							path={path}
							permissions={permissions}
							slug={slug}
							threads={getInlineThreadsForFile(threads, file, comparison.files)}
							username={username}
						/>,
					] as const
				})
			),
		[
			anchorableSides,
			diffAnchorComparison,
			comparison.baseSha,
			comparison.files,
			comparison.headSha,
			number,
			permissions,
			slug,
			threads,
			username,
		]
	)

	const outdatedThreads = unanchoredThreads.length > 0 && (
		<div className="overflow-hidden rounded-md border border-border">
			<PullRequestOutdatedThreads
				number={number}
				permissions={permissions}
				slug={slug}
				threads={unanchoredThreads}
				title={
					isSinceReview
						? 'Comments on files these commits leave untouched'
						: 'Outdated discussions'
				}
				username={username}
			/>
		</div>
	)
	const toolbar = (
		<div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
				{toolbarLead}
				<p className="font-medium text-sm">
					{viewedPaths
						? `${viewedCount} / ${comparison.files.length} files viewed`
						: `${comparison.files.length} changed files`}
				</p>
			</div>
			{toolbarAction}
		</div>
	)
	const fileTree = (
		<PullRequestFileTree
			activePath={activePath}
			files={comparison.files}
			onPrefetch={prefetchFile}
			onSelect={path =>
				scrollToSection(path, shouldReduceMotion ? 'auto' : 'smooth')
			}
			viewedPaths={viewedPaths}
		/>
	)

	if (comparison.files.length === 0)
		return (
			<div className="flex flex-col gap-3">
				{(toolbarAction || toolbarLead) && toolbar}
				<PullRequestsMessage
					description={
						isSinceReview
							? 'These commits changed no files, only history.'
							: 'The source and target branches contain the same files.'
					}
					title="No changed files"
				/>
				{outdatedThreads}
			</div>
		)

	return (
		<div className="flex flex-col gap-3">
			{comparison.isTruncated && (
				<PullRequestsMessage
					description={`Only the first ${comparison.fileLimit} changed files are shown.`}
					title="File list truncated"
				/>
			)}
			<PullRequestFileNotices
				hasThreadsError={threadsQuery.isError}
				hasViewedError={viewedFilesQuery.isError}
				hasViewedSaveError={setFileViewedMutation.isError}
				viewedSaveError={setFileViewedMutation.error}
			/>
			{permissions.canComment && isSinceReview && (
				<p className="text-muted-foreground text-sm">
					Comments on already-reviewed lines are available in the full diff.
				</p>
			)}
			{toolbar}
			<details className="lg:hidden">
				<summary className="cursor-pointer text-muted-foreground text-sm">
					Files ({comparison.files.length})
				</summary>
				<div className="mt-2">{fileTree}</div>
			</details>
			<div className="lg:grid lg:grid-cols-[18.75rem_minmax(0,1fr)] lg:items-start lg:gap-6">
				{/* The tree brings its own viewport-height scroller, so the column only pins it. */}
				<aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)]">
					{fileTree}
				</aside>
				<div className="flex min-w-0 flex-col gap-4">
					{comparison.files.map(file => {
						const path = getChangedFilePath(file)
						const isViewed = viewedPaths?.has(path) ?? false
						const isExpanded =
							expansionOverrides[path] ??
							!(isViewed || isLargeChangedFile(file))

						return (
							<PullRequestFileSection
								canMarkViewed={isViewedStateKnown}
								displayPath={
									file.status === 'renamed'
										? `${file.oldPath} → ${file.newPath}`
										: path
								}
								file={file}
								isExpanded={isExpanded}
								isNearViewport={nearViewportPaths.includes(path)}
								isViewed={isViewed}
								isViewedPending={pendingViewedPaths.includes(path)}
								key={`${file.oldPath}:${file.newPath}`}
								onPrefetch={prefetchFile}
								onRegisterNode={registerSectionNode}
								onToggleExpanded={setExpanded}
								onToggleViewed={toggleViewed}
								path={path}
							>
								{isExpanded && fileDiffViews.get(path)}
							</PullRequestFileSection>
						)
					})}
					{outdatedThreads}
				</div>
			</div>
		</div>
	)
}

interface PullRequestFileNoticesProps {
	hasThreadsError: boolean
	hasViewedError: boolean
	hasViewedSaveError: boolean
	viewedSaveError: unknown
}

function PullRequestFileNotices({
	hasThreadsError,
	hasViewedError,
	hasViewedSaveError,
	viewedSaveError,
}: Readonly<PullRequestFileNoticesProps>) {
	return (
		<>
			{hasThreadsError && (
				<p className="text-destructive text-sm" role="alert">
					The comments for these files could not be loaded.
				</p>
			)}
			{hasViewedError && (
				<p className="text-destructive text-sm" role="alert">
					Which files you have already viewed could not be loaded.
				</p>
			)}
			{hasViewedSaveError && (
				<p className="text-destructive text-sm" role="alert">
					{isPullRequestStaleComparisonError(viewedSaveError)
						? 'The diff changed and was reloaded.'
						: 'The viewed state could not be saved.'}
				</p>
			)}
		</>
	)
}
