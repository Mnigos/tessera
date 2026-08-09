import type { Check, ChecksSummary, RequiredContext } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Skeleton } from '@repo/ui/components/skeleton'
import { cn } from '@repo/ui/utils'
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

/**
 * Results reported on the pull request's head, and the requirements nothing
 * reported at all.
 *
 * A rollup of `none` is no longer reason enough to render nothing: a protected
 * branch requiring a check that never ran is the emptiest possible rollup and
 * the most important thing this panel can say. So the read happens either way
 * and the panel disappears only once it knows there is genuinely nothing —
 * neither a result nor an unmet requirement — to show.
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
	const rollup = getCheckRollupPresentation(checksSummary.overall)
	const missingRequiredContexts =
		checksQuery.data?.missingRequiredContexts ?? []

	// Nothing reported and nothing required: there is no panel to draw. Waiting
	// for the read before deciding keeps a pull request with no checks from
	// flashing an empty card at every reader.
	//
	// A read that failed is not an empty one. On a pull request with no results
	// of its own, the requirements it could not load are the whole of what this
	// panel had to say, and disappearing would read as "nothing is required".
	if (
		checksSummary.overall === 'none' &&
		!(checksQuery.isError || missingRequiredContexts.length > 0)
	)
		return null

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
				missingRequiredContexts={missingRequiredContexts}
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
