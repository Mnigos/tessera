import type { Repository } from '@repo/contracts'
import { cn } from '@repo/ui/utils'

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

const SYNC_STATUS_LABELS = {
	pending: 'Pending',
	running: 'Running',
	succeeded: 'Succeeded',
	failed: 'Failed',
} satisfies Record<string, string>

const SYNC_STATUS_CLASS_NAMES = {
	pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
	running: 'border-blue-500/30 bg-blue-500/10 text-blue-700',
	succeeded: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
	failed: 'border-destructive/40 bg-destructive/10 text-destructive',
} satisfies Record<string, string>

interface GitHubMirrorStatusBadgeProps {
	status: Exclude<Repository['externalSource'], { mode: 'none' }>['syncStatus']
}

export function GitHubMirrorStatusBadge({
	status,
}: Readonly<GitHubMirrorStatusBadgeProps>) {
	return (
		<span
			className={cn(
				'inline-flex rounded-md border px-2 py-0.5 font-medium text-xs',
				SYNC_STATUS_CLASS_NAMES[status]
			)}
		>
			{SYNC_STATUS_LABELS[status]}
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
