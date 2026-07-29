import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useCutoverGitHubMirrorMutation } from '../hooks/use-cutover-github-mirror.mutation'

interface GitHubMirrorCutoverSectionProps {
	owner: RepositoryOwner
	repository: Repository
}

export function GitHubMirrorCutoverSection({
	owner,
	repository,
}: Readonly<GitHubMirrorCutoverSectionProps>) {
	const cutoverMutation = useCutoverGitHubMirrorMutation()
	const [isConfirmingCutover, setIsConfirmingCutover] = useState(false)

	function handleCutover() {
		if (cutoverMutation.isPending) return

		cutoverMutation.mutate({
			slug: repository.slug,
			username: owner.username,
		})
	}

	return (
		<div className="flex flex-col items-start gap-2">
			{isConfirmingCutover ? (
				<div className="flex max-w-xl flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
					<div className="flex items-start gap-2 text-sm">
						<ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
						<p>
							This stops GitHub-to-Tessera synchronization. Future writes must
							target Tessera.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={cutoverMutation.isPending}
							onClick={handleCutover}
							size="sm"
							variant="destructive"
						>
							{cutoverMutation.isPending
								? 'Changing authority…'
								: 'Confirm authority change'}
						</Button>
						<Button
							disabled={cutoverMutation.isPending}
							onClick={() => setIsConfirmingCutover(false)}
							size="sm"
							variant="secondary"
						>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<Button
					onClick={() => setIsConfirmingCutover(true)}
					size="sm"
					variant="ghost"
				>
					Make Tessera authoritative
				</Button>
			)}
			{cutoverMutation.isSuccess && (
				<p aria-live="polite" className="text-emerald-700 text-sm">
					Tessera is now authoritative.
				</p>
			)}
			{cutoverMutation.isError && (
				<p aria-live="polite" className="text-destructive text-sm">
					Authority could not be changed. Try again.
				</p>
			)}
		</div>
	)
}
