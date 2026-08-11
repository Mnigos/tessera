import type { RepositorySyncHealth } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Skeleton } from '@repo/ui/components/skeleton'
import { cn } from '@repo/ui/utils'
import {
	formatSyncLag,
	getRepositorySyncHealthPresentation,
} from '../helpers/repository-sync-health'
import { useGitHubReauthorizationQuery } from '../hooks/use-github-reauthorization.query'
import { MirrorTimestamp } from './repository-github-mirror-fields'

interface RepositoryGitHubSyncHealthCardProps {
	isError: boolean
	isLoading: boolean
	slug: string
	syncHealth?: RepositorySyncHealth
	username: string
}

const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
	style: 'percent',
	maximumFractionDigits: 0,
})

/**
 * Everything the read model knows, for the one person who can do something
 * about it. The overview says only whether to trust what it is showing; this is
 * where the numbers behind that live.
 */
export function RepositoryGitHubSyncHealthCard({
	isError,
	isLoading,
	slug,
	syncHealth,
	username,
}: Readonly<RepositoryGitHubSyncHealthCardProps>) {
	return (
		<Card className="gap-3 p-4">
			<h2 className="font-semibold text-base tracking-normal">Sync health</h2>
			<SyncHealthBody
				isError={isError}
				isLoading={isLoading}
				slug={slug}
				syncHealth={syncHealth}
				username={username}
			/>
		</Card>
	)
}

function SyncHealthBody({
	isError,
	isLoading,
	slug,
	syncHealth,
	username,
}: Readonly<RepositoryGitHubSyncHealthCardProps>) {
	if (isLoading)
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-4 max-w-48" />
				<Skeleton className="h-4 max-w-64" />
			</div>
		)

	if (isError)
		return (
			<p className="text-destructive text-sm" role="alert">
				Synchronization health could not be loaded.
			</p>
		)

	// No health at all means no mirror is running, which is a different thing
	// from a mirror that is doing badly and must not be dressed as one.
	if (!syncHealth)
		return (
			<p className="text-muted-foreground text-sm">
				Nothing is being synchronized from GitHub for this repository.
			</p>
		)

	const presentation = getRepositorySyncHealthPresentation(syncHealth)
	const freshnessLag = formatSyncLag(syncHealth.freshnessLagSeconds)
	const deliveryLag = formatSyncLag(syncHealth.deliveryLagSeconds)

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<span
					className={cn(
						'inline-flex items-center gap-2 font-medium text-sm',
						presentation.iconClassName
					)}
				>
					<presentation.icon aria-hidden className="size-4 shrink-0" />
					{presentation.label}
				</span>
				<p className="text-muted-foreground text-sm">
					{presentation.description}
				</p>
				{syncHealth.message && (
					<p className="text-muted-foreground text-sm">{syncHealth.message}</p>
				)}
			</div>
			{syncHealth.reauthorizationRequired && (
				<GitHubReauthorizationGuidance slug={slug} username={username} />
			)}
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
				<SyncHealthFact
					label="Last successful sync"
					value={freshnessLag ? `${freshnessLag} ago` : 'Never'}
				/>
				<SyncHealthFact
					label="Unprocessed deliveries"
					value={String(syncHealth.pendingDeliveryCount)}
				/>
				<SyncHealthFact
					label="Oldest waiting delivery"
					value={deliveryLag ? `${deliveryLag} ago` : 'None waiting'}
				/>
				<SyncHealthFact
					label="Retries (24h)"
					value={String(syncHealth.retryCount24h)}
				/>
				<SyncHealthFact
					label="Failure rate (24h)"
					value={PERCENT_FORMATTER.format(syncHealth.failureRate24h)}
				/>
				<SyncHealthFact
					label="Last run duration"
					value={
						syncHealth.lastReconciliationDurationMs === undefined
							? 'Unknown'
							: `${syncHealth.lastReconciliationDurationMs} ms`
					}
				/>
				{syncHealth.rateLimitedUntil && (
					<MirrorTimestamp
						label="Rate limit resets"
						value={syncHealth.rateLimitedUntil}
					/>
				)}
			</dl>
		</div>
	)
}

interface SyncHealthFactProps {
	label: string
	value: string
}

function SyncHealthFact({ label, value }: Readonly<SyncHealthFactProps>) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</dt>
			<dd>{value}</dd>
		</div>
	)
}

interface GitHubReauthorizationGuidanceProps {
	slug: string
	username: string
}

/**
 * The only remedy that exists, and it is not a retry: Tessera resumes when
 * GitHub announces the restored grant, so this points at the grant and makes no
 * promise about when synchronization starts again.
 *
 * The guidance stands on its own whatever the link does. Failing to load a URL
 * says nothing about the mirror — the block is already established by the
 * health read above — so a failure here is reported as what it is, a link that
 * could not be fetched, with an ordinary reload rather than anything resembling
 * a synchronization retry.
 */
function GitHubReauthorizationGuidance({
	slug,
	username,
}: Readonly<GitHubReauthorizationGuidanceProps>) {
	const reauthorizationQuery = useGitHubReauthorizationQuery({ slug, username })

	return (
		<div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
			<h3 className="font-medium">Access has to be granted again</h3>
			<p className="text-muted-foreground">
				Tessera can no longer read this repository through the GitHub App.
				Reinstall or re-grant access on GitHub; synchronization resumes on its
				own once GitHub confirms it.
			</p>
			<GitHubReauthorizationLink
				installUrl={reauthorizationQuery.data?.installUrl}
				isError={reauthorizationQuery.isError}
				isLoading={reauthorizationQuery.isLoading}
				onReload={() => reauthorizationQuery.refetch()}
			/>
		</div>
	)
}

interface GitHubReauthorizationLinkProps {
	installUrl?: string
	isError: boolean
	isLoading: boolean
	onReload: () => void
}

function GitHubReauthorizationLink({
	installUrl,
	isError,
	isLoading,
	onReload,
}: Readonly<GitHubReauthorizationLinkProps>) {
	if (isLoading) return <Skeleton className="h-4 max-w-56" />

	if (isError)
		return (
			<div className="flex flex-wrap items-center gap-2">
				<p className="text-muted-foreground">
					The reauthorization link could not be loaded.
				</p>
				<Button onClick={onReload} size="sm" variant="outline">
					Retry
				</Button>
			</div>
		)

	// The API refuses to report a required reauthorization it cannot direct
	// anybody to, so a settled read either carries the URL or is the error above.
	if (!installUrl) return null

	return (
		<a
			className="w-fit underline hover:text-foreground"
			href={installUrl}
			rel="noreferrer"
			target="_blank"
		>
			Review the GitHub App installation
		</a>
	)
}
