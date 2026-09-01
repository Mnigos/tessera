import {
	GITHUB_IMPORT_SEARCH_MAX_LENGTH,
	type GitHubRepositoryImport,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { FaGithub } from 'react-icons/fa'
import { z } from 'zod'
import { reconnectGitHub } from '@/modules/auth/helpers/reconnect-github'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { GitHubImportActivity } from '../components/github-import-activity'
import { GitHubImportLoadingState } from '../components/github-import-loading-state'
import { GitHubImportMessage } from '../components/github-import-message'
import { GitHubImportSourceSelector } from '../components/github-import-source-selector'
import { parseIdList, serializeIdList } from '../helpers/id-list'
import { isGitHubImportSourceConflictError } from '../helpers/is-github-import-source-conflict-error'
import { scrollToGitHubImportActivity } from '../helpers/scroll-to-github-import-activity'
import { useCreateGitHubImportMutation } from '../hooks/use-create-github-import.mutation'
import { useGitHubImportRepositoriesQuery } from '../hooks/use-github-import-repositories.query'
import { useGitHubImportSelection } from '../hooks/use-github-import-selection'
import { useGitHubImportsQuery } from '../hooks/use-github-imports.query'

const UUID_LIST_REGEX =
	/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}(,[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12})*$/i

export const Route = createFileRoute('/import/github')({
	validateSearch: z.object({
		q: z.string().trim().min(1).max(GITHUB_IMPORT_SEARCH_MAX_LENGTH).optional(),
		selectedRepositoryIds: z
			.string()
			.regex(/^\d+(,\d+)*$/)
			.optional(),
		queuedImportIds: z.string().regex(UUID_LIST_REGEX).optional(),
	}),
	head: () => ({
		meta: [
			{ title: 'Import from GitHub · detent' },
			{
				name: 'description',
				content: 'Choose a GitHub repository to import into detent.',
			},
		],
	}),
	component: GitHubImportRoute,
})

function GitHubImportRoute() {
	const {
		q,
		queuedImportIds: queuedImportIdsSearch,
		selectedRepositoryIds: selectedRepositoryIdsSearch,
	} = Route.useSearch()
	const navigate = useNavigate({ from: '/import/github' })
	const { isLoading: isAuthLoading, signIn, user } = useAuth()
	const isAuthenticated = user != null
	const repositoriesQuery = useGitHubImportRepositoriesQuery(
		{ search: q },
		isAuthenticated
	)
	const repositories =
		repositoriesQuery.data?.pages.flatMap(page => page.repositories) ?? []
	const selection = useGitHubImportSelection(
		selectedRepositoryIdsSearch,
		repositories
	)
	const importsQuery = useGitHubImportsQuery(isAuthenticated)
	const createImportMutation = useCreateGitHubImportMutation()
	const [importError, setImportError] = useState<unknown>()
	const [conflictSourceGithubIds, setConflictSourceGithubIds] = useState<
		string[]
	>([])
	const [isImportingBatch, setIsImportingBatch] = useState(false)
	const [isPickerExpanded, setIsPickerExpanded] = useState<boolean>()
	const queuedImportIds = parseIdList(queuedImportIdsSearch)
	const imports = importsQuery.data?.imports ?? []
	const isImportSession = queuedImportIds.length > 0
	const isPickerVisible =
		isPickerExpanded ??
		(!isImportSession || selection.selectedRepositoryIds.length > 0)
	const completedImportTarget = getCompletedImportTarget(
		imports,
		queuedImportIds,
		user?.username
	)

	function handleQueryChange(nextQuery: string | undefined) {
		navigate({
			search: previousSearch => ({ ...previousSearch, q: nextQuery }),
		})
	}

	function handleLoadMore() {
		repositoriesQuery.fetchNextPage({ cancelRefetch: false })
	}

	async function handleContinue() {
		if (isImportingBatch) return

		setImportError(undefined)
		setConflictSourceGithubIds([])
		setIsImportingBatch(true)
		const failedRepositoryIds: string[] = []
		const conflictRepositoryIds: string[] = []
		const createdImportIds: string[] = []
		let firstImportError: unknown

		try {
			for (const githubId of selection.selectedRepositoryIds) {
				try {
					const { import: createdImport } =
						await createImportMutation.mutateAsync({ githubId })

					createdImportIds.push(createdImport.id)
				} catch (error) {
					// An already-running import is not a dead end: point at its row instead.
					if (isGitHubImportSourceConflictError(error)) {
						conflictRepositoryIds.push(githubId)
						continue
					}

					failedRepositoryIds.push(githubId)
					firstImportError ??= error
				}
			}

			setImportError(firstImportError)
			setConflictSourceGithubIds(conflictRepositoryIds)
			setIsPickerExpanded(undefined)
			await navigate({
				search: previousSearch => ({
					...previousSearch,
					queuedImportIds: serializeIdList([
						...new Set([...queuedImportIds, ...createdImportIds]),
					]),
					selectedRepositoryIds: serializeIdList(failedRepositoryIds),
				}),
			})
			scrollToGitHubImportActivity(conflictRepositoryIds[0])
		} finally {
			setIsImportingBatch(false)
		}
	}

	function handleTogglePicker() {
		setIsPickerExpanded(!isPickerVisible)
	}

	const sourceSelector = (
		<GitHubImportSourceSelector
			error={repositoriesQuery.error}
			hasNextPage={repositoriesQuery.hasNextPage}
			importError={importError}
			isError={repositoriesQuery.isError}
			isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
			isFetchNextPageError={repositoriesQuery.isFetchNextPageError}
			isImporting={isImportingBatch || createImportMutation.isPending}
			isLoading={repositoriesQuery.isLoading}
			isSearching={repositoriesQuery.isPlaceholderData}
			onContinue={handleContinue}
			onLoadMore={handleLoadMore}
			onQueryChange={handleQueryChange}
			onReconnectGitHub={reconnectGitHub}
			onSelectAllRepositories={selection.selectAllLoaded}
			onToggleRepository={selection.toggleRepository}
			query={q ?? ''}
			repositories={repositories}
			selectedRepositories={selection.selectedRepositories}
			selectedRepositoryIds={selection.selectedRepositoryIds}
		/>
	)
	const importActivity = (
		<GitHubImportActivity
			conflictSourceGithubIds={conflictSourceGithubIds}
			imports={imports}
			isError={importsQuery.isError}
			isLoading={importsQuery.isLoading}
			queuedImportIds={queuedImportIds}
			username={user?.username}
		/>
	)

	return (
		<main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
			<div className="flex max-w-3xl flex-col gap-2">
				<p className="font-medium text-muted-foreground text-sm">
					GitHub import
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					{isImportSession
						? 'Importing repositories'
						: 'Choose a source repository'}
				</h1>
				<p className="text-muted-foreground">
					{isImportSession
						? 'Each import runs in the background. This page updates as they progress.'
						: 'Select one or more GitHub repositories. detent will queue each import when you continue, under your own handle — organizations cannot own an imported repository yet.'}
				</p>
			</div>
			{isAuthLoading ? (
				<GitHubImportLoadingState />
			) : user ? (
				isImportSession ? (
					<>
						{completedImportTarget && (
							<Navigate
								params={completedImportTarget}
								replace
								to="/$username/$slug"
							/>
						)}
						{importActivity}
						<div className="flex flex-col gap-4">
							<Button
								className="self-start"
								onClick={handleTogglePicker}
								size="sm"
								variant="secondary"
							>
								{isPickerVisible
									? 'Hide repository picker'
									: 'Import more repositories'}
							</Button>
							{isPickerVisible && sourceSelector}
						</div>
					</>
				) : (
					<>
						{sourceSelector}
						{importActivity}
					</>
				)
			) : (
				<GitHubImportMessage
					action={
						<Button onClick={() => signIn()} size="sm">
							<FaGithub className="size-4" />
							Sign in with GitHub
						</Button>
					}
					description="Sign in with GitHub before importing repositories."
					title="Sign in required"
				/>
			)}
		</main>
	)
}

/** A lone queued import lands the reader straight on the repository it created. */
function getCompletedImportTarget(
	imports: GitHubRepositoryImport[],
	queuedImportIds: string[],
	username?: string
) {
	if (queuedImportIds.length !== 1 || !username) return

	const queuedImport = imports.find(
		repositoryImport => repositoryImport.id === queuedImportIds[0]
	)

	if (queuedImport?.status !== 'succeeded' || !queuedImport.repositoryId) return

	return { slug: queuedImport.targetSlug, username }
}
