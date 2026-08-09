import type { Check, RequiredContext } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { ExternalLink } from 'lucide-react'
import {
	formatCheckDuration,
	getCheckStatePresentation,
	MISSING_CHECK_PRESENTATION,
} from '@/modules/checks/helpers/check-presentation'

/**
 * A requirement the branch imposes that nothing has answered.
 *
 * It carries no state, no provider and no link, because none of those exist:
 * the row is the absence itself, said out loud so a reader is not left to
 * notice which name is missing from the list below it.
 */
export function MissingRequiredCheckRow({
	requirement,
}: Readonly<{ requirement: RequiredContext }>) {
	return (
		<li className="flex items-start gap-3 px-4 py-2.5">
			<MISSING_CHECK_PRESENTATION.icon
				aria-hidden
				className={cn(
					'mt-0.5 size-4 shrink-0',
					MISSING_CHECK_PRESENTATION.iconClassName
				)}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<span
					className="truncate font-medium text-sm"
					title={requirement.context}
				>
					{requirement.context}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					Required by branch protection
					{requirement.kind && ` · ${requirement.kind}`}
				</span>
			</div>
			<span
				className={cn(
					'shrink-0 text-xs',
					MISSING_CHECK_PRESENTATION.iconClassName
				)}
			>
				{MISSING_CHECK_PRESENTATION.label}
			</span>
		</li>
	)
}

export function PullRequestCheckRow({ check }: Readonly<{ check: Check }>) {
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
