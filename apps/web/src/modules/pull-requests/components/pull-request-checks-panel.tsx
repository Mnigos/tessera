import type { Check, ChecksSummary, RequiredContext } from '@repo/contracts'
import { Skeleton } from '@repo/ui/components/skeleton'
import { cn } from '@repo/ui/utils'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import {
	getCheckRollupDescription,
	getCheckRollupPresentation,
} from '@/modules/checks/helpers/check-presentation'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import { usePullRequestChecksQuery } from '../hooks/use-pull-request-checks.query'
import {
	MissingRequiredCheckRow,
	PullRequestCheckRow,
} from './pull-request-check-rows'

interface PullRequestChecksPanelProps {
	username: string
	slug: string
	number: string
	checksSummary?: ChecksSummary
}

/** What a settled — or still unsettled — checks read knows about the rows. */
export interface PullRequestChecksReadState {
	isLoading: boolean
	isError: boolean
	data?: { missingRequiredContexts?: RequiredContext[] }
}

/**
 * Whether there is a checks section to draw at all.
 *
 * A rollup of `none` is no longer reason enough to render nothing: a protected
 * branch requiring a check that never ran is the emptiest possible rollup and
 * the most important thing this section can say. So the read happens either way
 * and the section disappears only once it knows there is genuinely nothing —
 * neither a result nor an unmet requirement — to show. Exported because the
 * merge box has to decide whether it has any row above the merge at all.
 */
export function hasPullRequestChecksSection(
	checksSummary: ChecksSummary | undefined,
	{ isLoading, isError, data }: PullRequestChecksReadState
) {
	if (!checksSummary) return false

	if (checksSummary.overall !== 'none') return true

	return (
		isLoading || isError || (data?.missingRequiredContexts?.length ?? 0) > 0
	)
}

/**
 * Results reported on the pull request's head, and the requirements nothing
 * reported at all — one row in the merge box, expandable into the full list.
 */
export function PullRequestChecksPanel({
	checksSummary,
	...target
}: Readonly<PullRequestChecksPanelProps>) {
	if (!checksSummary) return null

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
	// Settled checks fold away; running or failing ones are what the reader came
	// to watch, so those open the panel on arrival — and again when a settled
	// rollup turns active or failing under them.
	const [isExpanded, setIsExpanded] = useState(
		isCheckRollupWatchworthy(checksSummary.overall)
	)
	const [renderedOverall, setRenderedOverall] = useState(checksSummary.overall)

	if (renderedOverall !== checksSummary.overall) {
		setRenderedOverall(checksSummary.overall)
		if (isCheckRollupWatchworthy(checksSummary.overall)) setIsExpanded(true)
	}
	const rollup = getCheckRollupPresentation(checksSummary.overall)
	const missingRequiredContexts =
		checksQuery.data?.missingRequiredContexts ?? []

	if (!hasPullRequestChecksSection(checksSummary, checksQuery)) return null

	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
				<button
					aria-expanded={isExpanded}
					className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/50"
					onClick={() => setIsExpanded(expanded => !expanded)}
					type="button"
				>
					<rollup.icon
						aria-hidden
						className={cn('size-4 shrink-0', rollup.iconClassName)}
					/>
					<span className="truncate font-medium text-sm">{rollup.label}</span>
					<span className="truncate text-muted-foreground text-sm">
						{getCheckRollupDescription(checksSummary)}
					</span>
					<ChevronDown
						aria-hidden
						className={cn(
							'size-4 shrink-0 text-muted-foreground transition-transform',
							isExpanded && 'rotate-180'
						)}
					/>
				</button>
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
			{isExpanded && (
				<ChecksPanelBody
					checks={checksQuery.data?.checks}
					isError={checksQuery.isError}
					isLoading={checksQuery.isLoading}
					missingRequiredContexts={missingRequiredContexts}
				/>
			)}
		</div>
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
	missingRequiredContexts: RequiredContext[]
}

function ChecksPanelBody({
	checks,
	isError,
	isLoading,
	missingRequiredContexts,
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

	if (!(checks?.length || missingRequiredContexts.length))
		return (
			<p className="border-border border-t px-4 py-3 text-muted-foreground text-sm italic">
				No checks have reported on this commit yet.
			</p>
		)

	return (
		<ul className="divide-y divide-border border-border border-t">
			{/* Absences lead: a required check that never ran outranks every result
			    below it, and nothing further down the list implies it. */}
			{missingRequiredContexts.map(requirement => (
				<MissingRequiredCheckRow
					key={toRequirementKey(requirement)}
					requirement={requirement}
				/>
			))}
			{checks?.map(check => (
				<PullRequestCheckRow check={check} key={check.id} />
			))}
		</ul>
	)
}

function toRequirementKey({ context, kind, providerAppId }: RequiredContext) {
	return [context, kind ?? '', providerAppId ?? ''].join('\u0000')
}

function isCheckRollupWatchworthy(overall: ChecksSummary['overall']): boolean {
	return overall === 'pending' || overall === 'failure'
}
