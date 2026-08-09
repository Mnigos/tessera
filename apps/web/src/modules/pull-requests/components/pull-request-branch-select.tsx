import type { RepositoryBranchRef } from '@repo/contracts'
import { Label } from '@repo/ui/components/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { GitBranch } from 'lucide-react'

interface PullRequestBranchSelectProps {
	branches: RepositoryBranchRef[]
	errorMessageId?: string
	id: string
	label: string
	onValueChange: (branchName: string) => void
	value: string
}

/**
 * Branches and nothing else. A pull request is opened and retargeted between
 * branches, so the repository's tag-capable ref selector would offer refs that
 * cannot be either end of one.
 */
export function PullRequestBranchSelect({
	branches,
	errorMessageId,
	id,
	label,
	onValueChange,
	value,
}: Readonly<PullRequestBranchSelectProps>) {
	function handleValueChange(branchName: string | null) {
		if (!branchName) return

		onValueChange(branchName)
	}

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Select onValueChange={handleValueChange} value={value}>
				<SelectTrigger
					aria-describedby={errorMessageId}
					aria-invalid={Boolean(errorMessageId)}
					className="w-full min-w-0 justify-start"
					id={id}
				>
					<GitBranch className="size-4 shrink-0 text-muted-foreground" />
					<SelectValue placeholder="Select branch">
						<span className="min-w-0 truncate" title={value}>
							{value}
						</span>
					</SelectValue>
				</SelectTrigger>
				<SelectContent align="start">
					{branches.map(branch => (
						<SelectItem key={branch.name} value={branch.name}>
							<span className="min-w-0 truncate" title={branch.name}>
								{branch.name}
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}
