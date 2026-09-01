import type { GitHubImportRepository } from '@repo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { parseIdList, serializeIdList } from '../helpers/id-list'

function toggleId(ids: string[], id: string) {
	return ids.includes(id)
		? ids.filter(existing => existing !== id)
		: [...ids, id]
}

export function useGitHubImportSelection(
	selectedRepositoryIdsSearch: string | undefined,
	loadedRepositories: GitHubImportRepository[]
) {
	const navigate = useNavigate({ from: '/import/github' })
	const [cachedRepositories, setCachedRepositories] = useState<
		Record<string, GitHubImportRepository>
	>({})
	const selectedRepositoryIds = parseIdList(selectedRepositoryIdsSearch)
	const loadedById = new Map(
		loadedRepositories.map(repository => [repository.githubId, repository])
	)
	const selectedRepositories = selectedRepositoryIds
		.map(id => loadedById.get(id) ?? cachedRepositories[id])
		.filter(repository => repository !== undefined)

	function navigateSelection(nextIds: string[]) {
		navigate({
			search: previousSearch => ({
				...previousSearch,
				selectedRepositoryIds: serializeIdList(nextIds),
			}),
		})
	}

	function toggleRepository(repositoryId: string) {
		const repository = loadedById.get(repositoryId)

		if (repository)
			setCachedRepositories(cache => ({ ...cache, [repositoryId]: repository }))

		navigateSelection(toggleId(selectedRepositoryIds, repositoryId))
	}

	function selectAllLoaded() {
		const loadedIds = loadedRepositories.map(repository => repository.githubId)
		const allLoadedSelected =
			loadedIds.length > 0 &&
			loadedIds.every(id => selectedRepositoryIds.includes(id))

		if (allLoadedSelected) {
			navigateSelection(
				selectedRepositoryIds.filter(id => !loadedIds.includes(id))
			)
			return
		}

		setCachedRepositories(cache => ({
			...cache,
			...Object.fromEntries(
				loadedRepositories.map(repository => [repository.githubId, repository])
			),
		}))
		navigateSelection([...new Set([...selectedRepositoryIds, ...loadedIds])])
	}

	return {
		selectAllLoaded,
		selectedRepositories,
		selectedRepositoryIds,
		toggleRepository,
	}
}
