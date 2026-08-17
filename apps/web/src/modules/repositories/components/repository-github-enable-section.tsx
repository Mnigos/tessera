import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { useEnableGitHubMirrorMutation } from '../hooks/use-enable-github-mirror.mutation'

interface RepositoryGitHubEnableSectionProps {
	owner: RepositoryOwner
	repository: Repository
}

/**
 * Turns a one-off import into a mirror GitHub keeps current. It also hands
 * authority over: from here on GitHub owns the repository, and Tessera refuses
 * writes to it, which is the part worth saying before the click.
 */
export function RepositoryGitHubEnableSection({
	owner,
	repository,
}: Readonly<RepositoryGitHubEnableSectionProps>) {
	const enableMutation = useEnableGitHubMirrorMutation()
	// Success does not mean the page has caught up: the reads that replace this
	// section with the mirror's own surfaces are still in flight. Re-offering
	// "Enable mirror" in that window invites a second, redundant request.
	const isEnabling = enableMutation.isPending || enableMutation.isSuccess

	function handleEnableMirror() {
		if (isEnabling) return

		enableMutation.mutate({
			slug: repository.slug,
			username: owner.handle,
		})
	}

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Automatic mirroring
				</h2>
				<p className="text-muted-foreground text-sm">
					This repository was imported once and is not being kept current.
					Connecting the GitHub App makes GitHub the source of truth and keeps
					pull requests, reviews, and checks synchronized here.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					disabled={isEnabling}
					onClick={handleEnableMirror}
					size="sm"
					variant="secondary"
				>
					{isEnabling ? 'Enabling…' : 'Enable mirror'}
				</Button>
			</div>
			{enableMutation.isError && (
				<p className="text-destructive text-sm" role="alert">
					The mirror could not be enabled. Try again.
				</p>
			)}
		</Card>
	)
}
