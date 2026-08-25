import type {
	GitHubRepositoryImport,
	GitHubRepositoryImportStatus,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { getGitHubImportErrorMessage } from '../helpers/get-github-import-error-message'
import { useRetryGitHubImportMutation } from '../hooks/use-retry-github-import.mutation'

const FAILURE_REASON_FALLBACK =
	'This import failed for an unknown reason. Retry to try again.'
const RETRY_ERROR_FALLBACK = 'Retry could not be queued. Please try again.'
const ACTIVE_IMPORT_HINT =
	'This GitHub repository is already importing — follow its progress here.'

const STATUS_LABELS = {
	pending: 'Queued',
	running: 'Running',
	succeeded: 'Completed',
	failed: 'Failed',
} satisfies Record<GitHubRepositoryImportStatus, string>

const STATUS_BADGE_CLASSES = {
	pending: 'border-border bg-secondary text-secondary-foreground',
	running: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
	succeeded: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
	failed: 'border-destructive/40 bg-destructive/10 text-destructive',
} satisfies Record<GitHubRepositoryImportStatus, string>

const STATUS_BADGE_ICONS = {
	pending: Clock,
	running: Loader2,
	succeeded: CheckCircle2,
	failed: XCircle,
} satisfies Record<GitHubRepositoryImportStatus, typeof Clock>

interface GitHubImportActivityRowProps {
	import: GitHubRepositoryImport
	isHighlighted?: boolean
	username?: string
}

export function GitHubImportActivityRow({
	import: repositoryImport,
	isHighlighted = false,
	username,
}: Readonly<GitHubImportActivityRowProps>) {
	const retryMutation = useRetryGitHubImportMutation()
	const canOpenRepository =
		repositoryImport.status === 'succeeded' &&
		Boolean(username) &&
		Boolean(repositoryImport.repositoryId)
	const isFailed = repositoryImport.status === 'failed'

	function handleRetry() {
		retryMutation.mutate({ id: repositoryImport.id })
	}

	return (
		<div
			className={cn(
				'flex flex-col gap-3 py-3 first:pt-0 last:pb-0',
				isHighlighted &&
					'my-1 rounded-md bg-primary/5 px-3 py-3 ring-1 ring-primary/40 first:pt-3 last:pb-3'
			)}
			data-github-import-source={repositoryImport.source.githubId}
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex items-center gap-2">
						<p className="truncate font-medium text-sm">
							{repositoryImport.source.fullName}
						</p>
						<GitHubImportStatusBadge status={repositoryImport.status} />
					</div>
					<p className="text-muted-foreground text-xs">
						Target: {repositoryImport.targetSlug}
					</p>
					{isHighlighted && (
						<p className="text-primary text-xs">{ACTIVE_IMPORT_HINT}</p>
					)}
				</div>
				{canOpenRepository && username && (
					<Link
						className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-secondary px-3 font-medium text-secondary-foreground text-xs transition duration-150 ease-out hover:bg-secondary/80"
						params={{
							slug: repositoryImport.targetSlug,
							username,
						}}
						to="/$username/$slug"
					>
						Open repository
					</Link>
				)}
			</div>
			{isFailed && (
				<div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex min-w-0 flex-col gap-1">
						<p className="text-destructive text-xs">
							{repositoryImport.failureReason ?? FAILURE_REASON_FALLBACK}
						</p>
						{retryMutation.isError && (
							<p className="text-destructive text-xs">
								{getGitHubImportErrorMessage(
									retryMutation.error,
									RETRY_ERROR_FALLBACK
								)}
							</p>
						)}
					</div>
					<Button
						className="shrink-0"
						disabled={retryMutation.isPending}
						onClick={handleRetry}
						size="sm"
						variant="secondary"
					>
						<RotateCcw className="size-4" />
						{retryMutation.isPending ? 'Retrying...' : 'Retry'}
					</Button>
				</div>
			)}
		</div>
	)
}

interface GitHubImportStatusBadgeProps {
	status: GitHubRepositoryImportStatus
}

function GitHubImportStatusBadge({
	status,
}: Readonly<GitHubImportStatusBadgeProps>) {
	const Icon = STATUS_BADGE_ICONS[status]

	return (
		<span
			className={cn(
				'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-xs',
				STATUS_BADGE_CLASSES[status]
			)}
		>
			<Icon
				aria-hidden
				className={cn('size-3.5', status === 'running' && 'animate-spin')}
			/>
			{STATUS_LABELS[status]}
		</span>
	)
}
