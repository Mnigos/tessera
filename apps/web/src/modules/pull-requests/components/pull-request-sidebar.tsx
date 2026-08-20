import type {
	PullRequest,
	PullRequestAssignee,
	PullRequestEffectiveReviewState,
	PullRequestLabel,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { Avatar } from '@repo/ui/components/avatar'
import { getPullRequestLabelStyle } from '../helpers/pull-request-label-color'
import { PullRequestReviewersPanel } from './pull-request-reviewers-panel'
import { PullRequestSidebarSection } from './pull-request-sidebar-section'

interface PullRequestSidebarProps {
	username: string
	slug: string
	pullRequest: PullRequest
	reviewerRequests: PullRequestReviewerRequest[]
	effectiveReviewStates: PullRequestEffectiveReviewState[]
	reviewerCandidates: PullRequestReviewerCandidate[]
	reviewViewer: PullRequestReviewViewer
	isGitHubAuthoritative: boolean
	headSha?: string
	pendingCommentCount?: number
}

/**
 * The conversation's right-hand column: who is reading it, who owns it, and
 * what it is filed under. Assignees and labels are GitHub's to set, so Tessera
 * shows them and says so by offering nothing to change them with.
 */
export function PullRequestSidebar({
	username,
	slug,
	pullRequest,
	reviewerRequests,
	effectiveReviewStates,
	reviewerCandidates,
	reviewViewer,
	isGitHubAuthoritative,
	headSha,
	pendingCommentCount,
}: Readonly<PullRequestSidebarProps>) {
	const assignees = pullRequest.github?.assignees ?? []
	const labels = pullRequest.github?.labels ?? []

	return (
		<aside className="flex w-full flex-col lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
			<PullRequestReviewersPanel
				effectiveReviewStates={effectiveReviewStates}
				headSha={headSha}
				isGitHubAuthoritative={isGitHubAuthoritative}
				isOpen={pullRequest.state === 'open'}
				number={String(pullRequest.number)}
				pendingCommentCount={pendingCommentCount}
				reviewerCandidates={reviewerCandidates}
				reviewerRequests={reviewerRequests}
				slug={slug}
				username={username}
				viewer={reviewViewer}
			/>
			<PullRequestSidebarSection title="Assignees">
				<PullRequestAssigneeList assignees={assignees} />
			</PullRequestSidebarSection>
			<PullRequestSidebarSection title="Labels">
				<PullRequestLabelList labels={labels} />
			</PullRequestSidebarSection>
		</aside>
	)
}

function PullRequestAssigneeList({
	assignees,
}: Readonly<{ assignees: readonly PullRequestAssignee[] }>) {
	if (assignees.length === 0)
		return <p className="text-muted-foreground text-sm">No one</p>

	return (
		<ul className="flex flex-col gap-2">
			{assignees.map(assignee => (
				<li className="flex min-w-0 items-center gap-1.5" key={assignee.login}>
					<PullRequestAssigneeAvatar assignee={assignee} />
					<PullRequestAssigneeName assignee={assignee} />
				</li>
			))}
		</ul>
	)
}

function PullRequestAssigneeAvatar({
	assignee,
}: Readonly<{ assignee: PullRequestAssignee }>) {
	if (!assignee.avatarUrl)
		return (
			<Avatar
				className="size-5 shrink-0 text-[0.625rem]"
				displayName={assignee.login}
				size="sm"
			/>
		)

	// Decorative: the login it belongs to is rendered right beside it.
	return (
		<img
			alt=""
			className="size-5 shrink-0 rounded-full bg-muted"
			height={20}
			src={assignee.avatarUrl}
			width={20}
		/>
	)
}

function PullRequestAssigneeName({
	assignee,
}: Readonly<{ assignee: PullRequestAssignee }>) {
	if (!assignee.htmlUrl)
		return <span className="truncate text-sm">{assignee.login}</span>

	return (
		<a
			className="truncate text-sm hover:underline"
			href={assignee.htmlUrl}
			rel="noreferrer"
			target="_blank"
		>
			{assignee.login}
		</a>
	)
}

function PullRequestLabelList({
	labels,
}: Readonly<{ labels: readonly PullRequestLabel[] }>) {
	if (labels.length === 0)
		return <p className="text-muted-foreground text-sm">None yet</p>

	return (
		<ul className="flex flex-wrap gap-1.5">
			{labels.map(label => (
				<li key={label.name}>
					<span
						className="inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-xs"
						style={getPullRequestLabelStyle(label.color)}
						title={label.description}
					>
						{label.name}
					</span>
				</li>
			))}
		</ul>
	)
}
