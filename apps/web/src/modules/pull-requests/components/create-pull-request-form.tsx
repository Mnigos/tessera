import type { RepositoryBranchRef } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { GitBranch, GitPullRequest } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import {
	type CreatePullRequestFields,
	getCreatePullRequestFields,
	getInitialPullRequestBranches,
} from '../helpers/create-pull-request-input'

const BRANCH_ERROR_ID = 'pull-request-branch-error'
const CREATE_ERROR_ID = 'pull-request-create-error'

interface CreatePullRequestFormProps {
	username: string
	slug: string
	branches: RepositoryBranchRef[]
	defaultBranch: string
	errorMessage?: string
	isPending: boolean
	onSubmit: (fields: CreatePullRequestFields) => void
}

export function CreatePullRequestForm({
	username,
	slug,
	branches,
	defaultBranch,
	errorMessage,
	isPending,
	onSubmit,
}: Readonly<CreatePullRequestFormProps>) {
	const initialBranches = getInitialPullRequestBranches(branches, defaultBranch)
	const [sourceBranch, setSourceBranch] = useState(initialBranches.sourceBranch)
	const [targetBranch, setTargetBranch] = useState(initialBranches.targetBranch)
	const hasSameBranches = sourceBranch === targetBranch

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const fields = getCreatePullRequestFields({
			formData: new FormData(event.currentTarget),
			sourceBranch,
			targetBranch,
		})

		if (!fields) return

		onSubmit(fields)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{username}/{slug}
				</p>
				<h1 className="font-semibold text-2xl tracking-normal">
					New pull request
				</h1>
			</div>
			<form
				aria-describedby={errorMessage ? CREATE_ERROR_ID : undefined}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<PullRequestBranchSelect
						branches={branches}
						errorMessageId={hasSameBranches ? BRANCH_ERROR_ID : undefined}
						label="Source branch"
						onValueChange={setSourceBranch}
						value={sourceBranch}
					/>
					<PullRequestBranchSelect
						branches={branches}
						errorMessageId={hasSameBranches ? BRANCH_ERROR_ID : undefined}
						label="Target branch"
						onValueChange={setTargetBranch}
						value={targetBranch}
					/>
				</div>
				{hasSameBranches && (
					<p
						className="text-destructive text-sm"
						id={BRANCH_ERROR_ID}
						role="alert"
					>
						The source and target branches must be different.
					</p>
				)}
				<div className="flex flex-col gap-2">
					<Label htmlFor="pull-request-title">Title</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="pull-request-title"
						maxLength={256}
						name="title"
						placeholder="Describe the change"
						required
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="pull-request-body">Description</Label>
					<textarea
						className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="pull-request-body"
						maxLength={65_536}
						name="body"
						placeholder="optional"
					/>
				</div>
				{errorMessage && (
					<p
						className="text-destructive text-sm"
						id={CREATE_ERROR_ID}
						role="alert"
					>
						{errorMessage}
					</p>
				)}
				<Button
					className="w-fit"
					disabled={isPending || hasSameBranches}
					type="submit"
				>
					<GitPullRequest className="size-4" />
					{isPending ? 'Creating' : 'Create pull request'}
				</Button>
			</form>
		</Card>
	)
}

interface PullRequestBranchSelectProps {
	branches: RepositoryBranchRef[]
	errorMessageId?: string
	label: string
	onValueChange: (branchName: string) => void
	value: string
}

function PullRequestBranchSelect({
	branches,
	errorMessageId,
	label,
	onValueChange,
	value,
}: Readonly<PullRequestBranchSelectProps>) {
	const id = `pull-request-${label.toLowerCase().replaceAll(' ', '-')}`

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
