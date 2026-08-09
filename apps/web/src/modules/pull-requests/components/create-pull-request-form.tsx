import type { RepositoryBranchRef } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { GitPullRequest } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import {
	type CreatePullRequestFields,
	getCreatePullRequestFields,
	getInitialPullRequestBranches,
} from '../helpers/create-pull-request-input'
import { PullRequestBranchSelect } from './pull-request-branch-select'
import { PullRequestMarkdownEditor } from './pull-request-markdown-editor'

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
						id="pull-request-source-branch"
						label="Source branch"
						onValueChange={setSourceBranch}
						value={sourceBranch}
					/>
					<PullRequestBranchSelect
						branches={branches}
						errorMessageId={hasSameBranches ? BRANCH_ERROR_ID : undefined}
						id="pull-request-target-branch"
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
				<PullRequestMarkdownEditor
					id="pull-request-body"
					label="Description"
					name="body"
					placeholder="optional"
				/>
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
