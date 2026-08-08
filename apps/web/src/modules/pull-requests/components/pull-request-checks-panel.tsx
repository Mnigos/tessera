import type { Check, ChecksSummary } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Skeleton } from '@repo/ui/components/skeleton'
import { cn } from '@repo/ui/utils'
import { ExternalLink } from 'lucide-react'
import {
	formatCheckDuration,
	getCheckRollupDescription,
	getCheckRollupPresentation,
	getCheckStatePresentation,
} from '../helpers/pull-request-checks'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import { usePullRequestChecksQuery } from '../hooks/use-pull-request-checks.query'

interface PullRequestChecksPanelProps {
	username: string
	slug: string
	number: string
	checksSummary?: ChecksSummary
}

/**
 * Results reported on the pull request's head.
 *
 * The summary arrives with the pull request, so the panel knows before it
 * fetches whether there is anything to show: a pull request nothing reports on
 * says so by rolling up to `none`, and renders no panel at all rather than a
 * permanent empty card. Checks are read-only imports, so this panel stays
 * visible on pull requests Tessera cannot write to.
 */
export function PullRequestChecksPanel({
	checksSummary,
	...target
}: Readonly<PullRequestChecksPanelProps>) {
	if (!checksSummary || checksSummary.overall === 'none') return null

	return <ChecksPanel {...target} checksSummary={checksSummary} />
}

interface ChecksPanelProps
	extends Omit<PullRequestChecksPanelProps, 'checksSummary'> {
	checksSummary: ChecksSummary
}

function ChecksPanel({
	username,
	slug,
	number,
	checksSummary,
}: Readonly<ChecksPanelProps>) {
	// The rows are fetched for the commit the summary is about, not for whatever
	// the head has become: a cached page from a previous head would otherwise
	// render its results underneath a newer head's rollup.
	const checksQuery = usePullRequestChecksQuery({
		username,
		slug,
		number,
		expectedHeadSha: checksSummary.headSha,
	})
	const rollup = getCheckRollupPresentation(checksSummary.overall)

	return (
		<Card className="gap-0 p-0">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
				<div className="flex min-w-0 items-center gap-2">
					<h2 className="font-semibold text-base tracking-normal">Checks</h2>
					<span
						className={cn(
							'inline-flex items-center gap-1.5 text-sm',
							rollup.iconClassName
						)}
					>
						<rollup.icon aria-hidden className="size-4 shrink-0" />
						{getCheckRollupDescription(checksSummary)}
					</span>
				</div>
				<ChecksPanelMeta
					// The warning is about the rows rendered below, so it follows the
					// read that produced them. The summary travelled with the pull
					// request and only says whether the commit was still the head then;
					// a head that has moved since would otherwise render its stale rows
					// with no warning at all until the page was reloaded.
					headIsCurrent={
						checksQuery.data?.headIsCurrent ?? checksSummary.headIsCurrent
					}
					lastResultAt={checksSummary.lastResultAt}
				/>
			</div>
			<ChecksPanelBody
				checks={checksQuery.data?.checks}
				isError={checksQuery.isError}
				isLoading={checksQuery.isLoading}
			/>
		</Card>
	)
}

interface ChecksPanelMetaProps {
	headIsCurrent: boolean
	lastResultAt?: Date
}

function ChecksPanelMeta({
	headIsCurrent,
	lastResultAt,
}: Readonly<ChecksPanelMetaProps>) {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
			{!headIsCurrent && (
				<span className="text-amber-400">
					Reported on an earlier commit than the current head.
				</span>
			)}
			{lastResultAt && (
				<span>
					Last result{' '}
					<time dateTime={formatPullRequestDateTime(lastResultAt)}>
						{formatPullRequestDate(lastResultAt)}
					</time>
				</span>
			)}
		</div>
	)
}

interface ChecksPanelBodyProps {
	checks?: Check[]
	isError: boolean
	isLoading: boolean
}

function ChecksPanelBody({
	checks,
	isError,
	isLoading,
}: Readonly<ChecksPanelBodyProps>) {
	if (isLoading)
		return (
			<div className="flex flex-col gap-3 border-border border-t px-4 py-3">
				<Skeleton className="h-4 max-w-64" />
				<Skeleton className="h-4 max-w-48" />
				<Skeleton className="h-4 max-w-56" />
			</div>
		)

	if (isError)
		return (
			<p
				className="border-border border-t px-4 py-3 text-destructive text-sm"
				role="alert"
			>
				The checks for this commit could not be loaded.
			</p>
		)

	if (!checks?.length)
		return (
			<p className="border-border border-t px-4 py-3 text-muted-foreground text-sm italic">
				No checks have reported on this commit yet.
			</p>
		)

	return (
		<ul className="divide-y divide-border border-border border-t">
			{checks.map(check => (
				<PullRequestCheckRow check={check} key={check.id} />
			))}
		</ul>
	)
}

function PullRequestCheckRow({ check }: Readonly<{ check: Check }>) {
	const presentation = getCheckStatePresentation(check.state)
	const duration = formatCheckDuration(check.durationMs)
	const detail = check.outputTitle || check.description

	return (
		<li className="flex items-start gap-3 px-4 py-2.5">
			<presentation.icon
				aria-hidden
				className={cn('mt-0.5 size-4 shrink-0', presentation.iconClassName)}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm" title={check.context}>
					{check.context}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					<CheckProviderName check={check} />
					{detail && ` · ${detail}`}
				</span>
			</div>
			<span className="flex shrink-0 items-center gap-3 text-xs">
				<span
					className={presentation.iconClassName}
					// The raw provider wording is worth keeping within reach; the
					// normalized state is what the row actually claims.
					title={check.rawConclusion ?? check.rawStatus}
				>
					{presentation.label}
				</span>
				{duration && (
					<span className="text-muted-foreground tabular-nums">{duration}</span>
				)}
				{check.targetUrl && (
					<a
						className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
						href={check.targetUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						Details
						<ExternalLink aria-hidden className="size-3" />
						<span className="sr-only">for {check.context}</span>
					</a>
				)}
			</span>
		</li>
	)
}

function CheckProviderName({ check }: Readonly<{ check: Check }>) {
	const name = check.provider.appSlug
		? `${check.provider.name} (${check.provider.appSlug})`
		: check.provider.name

	if (!check.provider.url) return name

	return (
		<a
			className="hover:text-foreground hover:underline"
			href={check.provider.url}
			rel="noreferrer noopener"
			target="_blank"
		>
			{name}
		</a>
	)
}
