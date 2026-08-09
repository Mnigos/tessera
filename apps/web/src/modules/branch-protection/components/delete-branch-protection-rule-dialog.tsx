import { ORPCError } from '@orpc/client'
import type { BranchProtectionRule } from '@repo/contracts'
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
import { RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { getBranchProtectionErrorMessage } from '../helpers/get-branch-protection-error-message'
import { useDeleteBranchProtectionRuleMutation } from '../hooks/use-delete-branch-protection-rule.mutation'

interface DeleteBranchProtectionRuleDialogProps {
	username: string
	slug: string
	onReload: () => void
	rule: BranchProtectionRule
}

export function DeleteBranchProtectionRuleDialog({
	username,
	slug,
	onReload,
	rule,
}: Readonly<DeleteBranchProtectionRuleDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const deleteRule = useDeleteBranchProtectionRuleMutation()
	// The version this dialog holds is the one the card was rendered with, and a
	// conflict means somebody edited the rule since. Deleting what is on screen is
	// no longer what deleting would do, so the way out is the same as for a
	// refused save: read the rule again and decide against what it says now.
	const isVersionConflict =
		deleteRule.error instanceof ORPCError && deleteRule.error.status === 409

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) deleteRule.reset()
	}

	function handleDelete() {
		deleteRule.mutate(
			{ username, slug, ruleId: rule.id, expectedVersion: rule.version },
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger
				render={
					<Button
						aria-label={`Delete protection for ${rule.targetBranch}`}
						variant="ghost"
					/>
				}
			>
				<Trash2 className="size-4 text-muted-foreground" />
				Delete
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete protection rule</DialogTitle>
					<DialogDescription>
						Deleting the rule for {rule.targetBranch} stops enforcing its
						approvals, checks, and conversation requirements on {username}/
						{slug}. The deletion is recorded in the repository audit log with a
						copy of the policy being removed.
					</DialogDescription>
				</DialogHeader>
				{deleteRule.isError && (
					<div className="flex flex-col items-start gap-2">
						<p className="text-destructive text-sm" role="alert">
							{getBranchProtectionErrorMessage(deleteRule.error, {
								fallback: 'Protection rule could not be deleted.',
								notFound: 'This rule has already been deleted.',
							})}
						</p>
						{isVersionConflict && (
							<Button
								onClick={() => {
									setIsOpen(false)
									deleteRule.reset()
									onReload()
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								<RotateCcw className="size-4" />
								Reload rules
							</Button>
						)}
					</div>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="secondary" />}>
						Cancel
					</DialogClose>
					<Button
						disabled={deleteRule.isPending}
						onClick={handleDelete}
						variant="destructive"
					>
						{deleteRule.isPending ? 'Deleting' : 'Delete rule'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
