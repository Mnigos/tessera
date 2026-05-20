import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { authClient } from '@/lib/auth/client'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { GitHubImportActivity } from '../components/github-import-activity'
import { GitHubImportSourceSelector } from '../components/github-import-source-selector'
import { useCreateGitHubImportMutation } from '../hooks/use-create-github-import.mutation'
import { useGitHubImportRepositoriesQuery } from '../hooks/use-github-import-repositories.query'
import { useGitHubImportsQuery } from '../hooks/use-github-imports.query'

export const Route = createFileRoute('/import/github')({
	validateSearch: z.object({
		selectedRepositoryIds: z
			.string()
			.regex(/^\d+(,\d+)*$/)
			.optional(),
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
	const { selectedRepositoryIds: selectedRepositoryIdsSearch } =
		Route.useSearch()
	const navigate = useNavigate({ from: '/import/github' })
	const { user } = useAuth()
	const repositoriesQuery = useGitHubImportRepositoriesQuery()
	const importsQuery = useGitHubImportsQuery()
	const createImportMutation = useCreateGitHubImportMutation()
	const [importError, setImportError] = useState<unknown>()
	const [isImportingBatch, setIsImportingBatch] = useState(false)
	const selectedRepositoryIds = parseSelectedRepositoryIds(
		selectedRepositoryIdsSearch
	)

	function handleToggleRepository(repositoryId: string) {
		navigate({
			search: previousSearch => ({
				...previousSearch,
				selectedRepositoryIds: serializeSelectedRepositoryIds(
					toggleSelectedRepositoryId(selectedRepositoryIds, repositoryId)
				),
			}),
		})
	}

	function handleSelectAllRepositories() {
		const repositoryIds =
			repositoriesQuery.data?.repositories.map(
				repository => repository.githubId
			) ?? []
		const allRepositoryIdsSelected =
			repositoryIds.length > 0 &&
			repositoryIds.every(repositoryId =>
				selectedRepositoryIds.includes(repositoryId)
			)
		const nextRepositoryIds = allRepositoryIdsSelected ? [] : repositoryIds

		navigate({
			search: previousSearch => ({
				...previousSearch,
				selectedRepositoryIds:
					serializeSelectedRepositoryIds(nextRepositoryIds),
			}),
		})
	}

	async function handleContinue() {
		if (isImportingBatch) return

		setImportError(undefined)
		setIsImportingBatch(true)
		const failedRepositoryIds: string[] = []

		try {
			for (const githubId of selectedRepositoryIds) {
				try {
					await createImportMutation.mutateAsync({ githubId })
				} catch (error) {
					failedRepositoryIds.push(githubId)
					setImportError(error)
				}
			}

			await navigate({
				search: previousSearch => ({
					...previousSearch,
					selectedRepositoryIds:
						serializeSelectedRepositoryIds(failedRepositoryIds),
				}),
			})
		} finally {
			setIsImportingBatch(false)
		}
	}

	async function handleReconnectGitHub() {
		await authClient.linkSocial({
			provider: 'github',
			scopes: ['repo'],
			callbackURL: window.location.href,
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
					Select one or more GitHub repositories. Tessera will queue each import
					when you continue.
				</p>
			</div>
			<GitHubImportSourceSelector
				error={repositoriesQuery.error}
				importError={importError ?? createImportMutation.error}
				isError={repositoriesQuery.isError}
				isImporting={isImportingBatch || createImportMutation.isPending}
				isLoading={repositoriesQuery.isLoading}
				onContinue={handleContinue}
				onReconnectGitHub={handleReconnectGitHub}
				onSelectAllRepositories={handleSelectAllRepositories}
				onToggleRepository={handleToggleRepository}
				repositories={repositoriesQuery.data?.repositories ?? []}
				selectedRepositoryIds={selectedRepositoryIds}
			/>
			<GitHubImportActivity
				imports={importsQuery.data?.imports ?? []}
				isError={importsQuery.isError}
				isLoading={importsQuery.isLoading}
				username={user?.username ?? undefined}
			/>
		</main>
	)
}

function parseSelectedRepositoryIds(selectedRepositoryIds?: string) {
	return selectedRepositoryIds?.split(',') ?? []
}

function serializeSelectedRepositoryIds(selectedRepositoryIds: string[]) {
	return selectedRepositoryIds.length > 0
		? selectedRepositoryIds.join(',')
		: undefined
}

function toggleSelectedRepositoryId(
	selectedRepositoryIds: string[],
	repositoryId: string
) {
	if (selectedRepositoryIds.includes(repositoryId))
		return selectedRepositoryIds.filter(
			selectedRepositoryId => selectedRepositoryId !== repositoryId
		)

	return [...selectedRepositoryIds, repositoryId]
}
