import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { GitHubImportSourceSelector } from '../components/github-import-source-selector'
import { useGitHubImportRepositoriesQuery } from '../hooks/use-github-import-repositories.query'

export const Route = createFileRoute('/import/github')({
	validateSearch: z.object({
		selectedRepositoryId: z.coerce.number().int().nonnegative().optional(),
	}),
	head: () => ({
		meta: [
			{ title: 'Import from GitHub · Tessera' },
			{
				name: 'description',
				content: 'Choose a GitHub repository to import into Tessera.',
			},
		],
	}),
	component: GitHubImportRoute,
})

function GitHubImportRoute() {
	const { selectedRepositoryId } = Route.useSearch()
	const navigate = useNavigate({ from: '/import/github' })
	const repositoriesQuery = useGitHubImportRepositoriesQuery()

	function handleSelectRepository(repositoryId: number) {
		navigate({
			search: previousSearch => ({
				...previousSearch,
				selectedRepositoryId: repositoryId,
			}),
		})
	}

	return (
		<main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
			<div className="flex max-w-3xl flex-col gap-2">
				<p className="font-medium text-muted-foreground text-sm">
					GitHub import
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					Choose a source repository
				</h1>
				<p className="text-muted-foreground">
					Select one GitHub repository now. Importing history starts in the next
					step.
				</p>
			</div>
			<GitHubImportSourceSelector
				error={repositoriesQuery.error}
				isError={repositoriesQuery.isError}
				isLoading={repositoriesQuery.isLoading}
				onSelectRepository={handleSelectRepository}
				repositories={repositoriesQuery.data?.repositories ?? []}
				selectedRepositoryId={selectedRepositoryId}
			/>
		</main>
	)
}
