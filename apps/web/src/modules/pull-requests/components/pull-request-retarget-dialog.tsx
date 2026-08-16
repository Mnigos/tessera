import type { PullRequest } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui/components/dialog'
import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import { useRepositoryRefsQuery } from '@/modules/repositories/hooks/use-repository-refs.query'
import { useRetargetPullRequestMutation } from '../hooks/use-retarget-pull-request.mutation'
import { PullRequestBranchSelect } from './pull-request-branch-select'
import { PullRequestErrorMessage } from './pull-request-error-message'

interface PullRequestRetargetDialogProps {
	username: string
	slug: string
	pullRequest: PullRequest
}

/**
 * Moves an open pull request onto another target branch.
 *
 * The source branch is not offered: it is what the pull request is, and every
 * review, check and thread on it was made about that history. Only the branch
 * the change is going to can move.
 */
export function PullRequestRetargetDialog({
	username,
	slug,
	pullRequest,
}: Readonly<PullRequestRetargetDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const [targetBranch, setTargetBranch] = useState(pullRequest.targetBranch)
	// Asked for only once the dialog is open, so every pull request page does not
	// load the repository's branches to offer a button nobody pressed.
	const refsQuery = useRepositoryRefsQuery({ username, slug }, isOpen)
	const retargetMutation = useRetargetPullRequestMutation()
	const branches = (refsQuery.data?.branches ?? []).filter(
		branch => branch.name !== pullRequest.sourceBranch
	)
	const isUnchanged = targetBranch === pullRequest.targetBranch

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (open) setTargetBranch(pullRequest.targetBranch)
		else retargetMutation.reset()
	}

	function handleRetarget() {
		retargetMutation.mutate(
			{ username, slug, number: pullRequest.number, targetBranch },
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger render={<Button size="sm" variant="ghost" />}>
				<GitBranch className="size-4" />
				Change target
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Change target branch</DialogTitle>
					<DialogDescription>
						Merging this pull request will put {pullRequest.sourceBranch} on the
						branch you choose. Comments left on lines of the current diff become
						outdated, and approvals already given still stand.
					</DialogDescription>
				</DialogHeader>
				{refsQuery.isError ? (
					<p className="text-destructive text-sm" role="alert">
						The repository branches could not be loaded.
					</p>
				) : (
					<PullRequestBranchSelect
						branches={branches}
						id="pull-request-retarget-branch"
						label="Target branch"
						onValueChange={setTargetBranch}
						value={targetBranch}
					/>
				)}
				{retargetMutation.isError && (
					<PullRequestErrorMessage
						error={retargetMutation.error}
						fallback="The target branch could not be changed."
					/>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="secondary" />}>
						Cancel
					</DialogClose>
					<Button
						disabled={
							retargetMutation.isPending || isUnchanged || refsQuery.isError
						}
						onClick={handleRetarget}
					>
						{retargetMutation.isPending ? 'Changing' : 'Change target branch'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
