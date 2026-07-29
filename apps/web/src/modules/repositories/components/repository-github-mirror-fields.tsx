import type { Repository } from '@repo/contracts'
import { cn } from '@repo/ui/utils'

type GitHubMirrorStatus = Exclude<
	Repository['externalSource'],
	{ mode: 'none' }
>['syncStatus']

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

const SYNC_STATUS_LABELS = {
	pending: 'Sync queued',
	running: 'Syncing…',
	succeeded: 'Synced',
	failed: 'Sync failed',
	blocked: 'Sync blocked',
} satisfies Record<GitHubMirrorStatus, string>

const SYNC_STATUS_CLASS_NAMES = {
	pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
	running: 'border-blue-500/30 bg-blue-500/10 text-blue-700',
	succeeded: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
	failed: 'border-destructive/40 bg-destructive/10 text-destructive',
	blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
} satisfies Record<GitHubMirrorStatus, string>

interface GitHubMirrorStatusBadgeProps {
	status: GitHubMirrorStatus
	timestamp?: Date | number | string
}

export function GitHubMirrorStatusBadge({
	status,
	timestamp,
}: Readonly<GitHubMirrorStatusBadgeProps>) {
	const date = toValidDate(timestamp)

	return (
		<span
			aria-live="polite"
			className={cn(
				'inline-flex rounded-md border px-2 py-0.5 font-medium text-xs',
				SYNC_STATUS_CLASS_NAMES[status]
			)}
		>
			{SYNC_STATUS_LABELS[status]}
			{date && (
				<>
					{' · '}
					<time
						dateTime={date.toISOString()}
						suppressHydrationWarning
						title={DATE_FORMATTER.format(date)}
					>
						{formatRelativeTime(date)}
					</time>
				</>
			)}
		</span>
	)
}

interface SourceFieldProps {
	label: string
	value: string
}

export function SourceField({ label, value }: Readonly<SourceFieldProps>) {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<span className="break-all">{value}</span>
		</div>
	)
}

interface MirrorTimestampProps {
	label: string
	value?: Date | number | string
}

export function MirrorTimestamp({
	label,
	value,
}: Readonly<MirrorTimestampProps>) {
	const date = value ? new Date(value) : undefined
	const labelText =
		date && !Number.isNaN(date.getTime())
			? DATE_FORMATTER.format(date)
			: 'Never'

	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<span suppressHydrationWarning>{labelText}</span>
		</div>
	)
}

function toValidDate(value?: Date | number | string) {
	if (!value) return undefined

	const date = new Date(value)

	return Number.isNaN(date.getTime()) ? undefined : date
}

function formatRelativeTime(date: Date) {
	const elapsedSeconds = Math.max(
		0,
		Math.round((Date.now() - date.getTime()) / 1000)
	)

	if (elapsedSeconds < 60) return 'just now'

	const elapsedMinutes = Math.round(elapsedSeconds / 60)
	if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`

	const elapsedHours = Math.round(elapsedMinutes / 60)
	if (elapsedHours < 24) return `${elapsedHours} h ago`

	const elapsedDays = Math.round(elapsedHours / 24)
	if (elapsedDays < 30) return `${elapsedDays} d ago`

	const elapsedMonths = Math.round(elapsedDays / 30)
	if (elapsedMonths < 12) return `${elapsedMonths} mo ago`

	const elapsedYears = Math.round(elapsedDays / 365)
	return `${elapsedYears} y ago`
}
