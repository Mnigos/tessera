import type { GitHubRepositoryImport } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Link } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { getGitHubImportErrorMessage } from '../helpers/get-github-import-error-message'
import { useRetryGitHubImportMutation } from '../hooks/use-retry-github-import.mutation'

const FAILURE_REASON_FALLBACK =
	'This import failed for an unknown reason. Retry to try again.'
const RETRY_ERROR_FALLBACK = 'Retry could not be queued. Please try again.'

interface GitHubImportActivityRowProps {
	import: GitHubRepositoryImport
	username?: string
}

export function GitHubImportActivityRow({
	import: repositoryImport,
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
		<div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
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
				{isFailed && (
					<p className="text-destructive text-xs">
						{repositoryImport.failureReason ?? FAILURE_REASON_FALLBACK}
					</p>
				)}
				{retryMutation.isError && (
					<p className="text-destructive text-xs">
						{getGitHubImportErrorMessage(
							retryMutation.error,
							RETRY_ERROR_FALLBACK
						)}
					</p>
				)}
			</div>
			{canOpenRepository && username && (
				<Link
					className="inline-flex h-8 items-center justify-center rounded-md bg-secondary px-3 font-medium text-secondary-foreground text-xs transition duration-150 ease-out hover:bg-secondary/80"
					params={{
						slug: repositoryImport.targetSlug,
						username,
					}}
					to="/$username/$slug"
				>
					Open
				</Link>
			)}
			{isFailed && (
				<Button
					disabled={retryMutation.isPending}
					onClick={handleRetry}
					size="sm"
					variant="secondary"
				>
					<RotateCcw className="size-4" />
					{retryMutation.isPending ? 'Retrying...' : 'Retry'}
				</Button>
			)}
		</div>
	)
}

interface GitHubImportStatusBadgeProps {
	status: GitHubRepositoryImport['status']
}

function GitHubImportStatusBadge({
	status,
}: Readonly<GitHubImportStatusBadgeProps>) {
	const className =
		status === 'failed'
			? 'border-destructive/40 bg-destructive/10 text-destructive'
			: 'border-border bg-secondary text-secondary-foreground'

	return (
		<span
			className={`inline-flex rounded-md border px-2 py-0.5 font-medium text-xs ${className}`}
		>
			{status}
		</span>
	)
}
