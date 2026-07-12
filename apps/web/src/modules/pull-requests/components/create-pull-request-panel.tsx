import type { PullRequest } from '@repo/contracts'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useRepositoryRefsQuery } from '@/modules/repositories/hooks/use-repository-refs.query'
import type { CreatePullRequestFields } from '../helpers/create-pull-request-input'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useCreatePullRequestMutation } from '../hooks/use-create-pull-request.mutation'
import { CreatePullRequestForm } from './create-pull-request-form'
import { PullRequestsMessage } from './pull-requests-message'

interface CreatePullRequestPanelProps {
	username: string
	slug: string
	onCreated: (pullRequest: PullRequest) => void
}

export function CreatePullRequestPanel({
	username,
	slug,
	onCreated,
}: Readonly<CreatePullRequestPanelProps>) {
	const { data, isError, isLoading } = useRepositoryRefsQuery({
		username,
		slug,
	})
	const createMutation = useCreatePullRequestMutation()

	if (isLoading)
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-10 max-w-lg" />
				<Skeleton className="h-64" />
			</div>
		)

	if (isError)
		return (
			<PullRequestsMessage
				description="The repository branches could not be loaded."
				title="Branches could not be loaded"
			/>
		)

	if (!data)
		return (
			<PullRequestsMessage
				description="The repository refs returned no data."
				title="Branches are unavailable"
			/>
		)

	if (data.branches.length < 2)
		return (
			<PullRequestsMessage
				description="A pull request needs two different branches. Push another branch and try again."
				title="Not enough branches"
			/>
		)

	const handleSubmit = (fields: CreatePullRequestFields) => {
		createMutation.mutate(
			{ username, slug, ...fields },
			{ onSuccess: pullRequest => onCreated(pullRequest) }
		)
	}

	return (
		<CreatePullRequestForm
			branches={data.branches}
			defaultBranch={data.repository.defaultBranch}
			errorMessage={
				createMutation.isError
					? getPullRequestErrorMessage(
							createMutation.error,
							'The pull request could not be created.'
						)
					: undefined
			}
			isPending={createMutation.isPending}
			onSubmit={handleSubmit}
			slug={slug}
			username={username}
		/>
	)
}
