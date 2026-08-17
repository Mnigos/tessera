import type {
	PullRequestChangedFile,
	PullRequestComparison as PullRequestComparisonData,
	PullRequestThreadSide,
	SessionUser,
} from '@repo/contracts'
import { useReducedMotion } from 'motion/react'
import { type ReactNode, useState } from 'react'
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

	function toggleViewed(path: string, viewed: boolean) {
		if (pendingViewedPaths.includes(path)) return

		setPendingViewedPaths(paths => [...paths, path])
		setExpanded(path, !viewed)
		setFileViewedMutation.mutate(
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
				onSettled: () =>
					setPendingViewedPaths(paths =>
						paths.filter(pendingPath => pendingPath !== path)
					),
			}
		)
	}

	// A file kept behind `Load diff` is the one not worth fetching on a passing pointer.
	function prefetchFile(file: PullRequestChangedFile) {
		if (isLargeChangedFile(file)) return

		prefetchFileDiff({
			username,
			slug,
			number,
			path: getChangedFilePath(file),
			expectedBaseSha: comparison.baseSha,
			expectedHeadSha: comparison.headSha,
		})
	}

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
		<div className="flex min-h-9 items-center justify-between gap-3">
			<p className="font-medium text-sm">
				{viewedPaths
					? `${viewedCount} / ${comparison.files.length} files viewed`
					: `${comparison.files.length} changed files`}
			</p>
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
				{toolbarAction && (
					<div className="flex justify-end">{toolbarAction}</div>
				)}
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
			<div className="lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:items-start lg:gap-4">
				<aside className="hidden lg:sticky lg:top-2 lg:block">{fileTree}</aside>
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
								onPrefetch={() => prefetchFile(file)}
								onRegisterNode={node => registerSectionNode(path, node)}
								onToggleExpanded={() => setExpanded(path, !isExpanded)}
								onToggleViewed={() => toggleViewed(path, !isViewed)}
								path={path}
							>
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
