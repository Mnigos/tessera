import type { GitHubImportRepository } from '@repo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { act, renderHook } from '@testing-library/react'
import { useGitHubImportSelection } from './use-github-import-selection'

vi.mock('@tanstack/react-router', () => ({ useNavigate: vi.fn() }))

interface SearchNavigation {
	search: (previousSearch: Record<string, unknown>) => Record<string, unknown>
}

const useNavigateMock = vi.mocked(useNavigate)
const navigate = vi.fn<(options: SearchNavigation) => void>()

function repository(
	githubId: string,
	fullName: string
): GitHubImportRepository {
	const [ownerLogin = 'marta', name = 'repository'] = fullName.split('/')

	return {
		githubId,
		ownerLogin,
		name,
		fullName,
		visibility: 'private',
		defaultBranch: 'main',
		githubUrl: `https://github.com/${fullName}`,
	}
}

const repositorySeven = repository('7', 'marta/notes')
const repositoryEight = repository('8', 'marta/tessera')

function applyLatestSearch(previousSearch: Record<string, unknown>) {
	const navigation = navigate.mock.calls.at(-1)?.[0]

	if (!navigation) throw new Error('Selection navigation missing')

	return navigation.search(previousSearch)
}

describe(useGitHubImportSelection.name, () => {
	beforeEach(() => {
		useNavigateMock.mockReturnValue(navigate as never)
	})

	test('toggles an id while keeping other search params', () => {
		const rendered = renderHook(
			({ selectedIds }) =>
				useGitHubImportSelection(selectedIds, [repositorySeven]),
			{ initialProps: { selectedIds: undefined as string | undefined } }
		)

		act(() => rendered.result.current.toggleRepository('7'))
		expect(applyLatestSearch({ q: 'notes', view: 'list' })).toEqual({
			q: 'notes',
			view: 'list',
			selectedRepositoryIds: '7',
		})

		rendered.rerender({ selectedIds: '7' })
		act(() => rendered.result.current.toggleRepository('7'))
		expect(applyLatestSearch({ q: 'notes', view: 'list' })).toEqual({
			q: 'notes',
			view: 'list',
			selectedRepositoryIds: undefined,
		})
	})

	test('unions loaded ids with the existing ordered selection', () => {
		const { result } = renderHook(() =>
			useGitHubImportSelection('9,7', [repositorySeven, repositoryEight])
		)

		act(() => result.current.selectAllLoaded())

		expect(applyLatestSearch({ q: 'notes' })).toEqual({
			q: 'notes',
			selectedRepositoryIds: '9,7,8',
		})
	})

	test('deselects only loaded ids when every loaded id is selected', () => {
		const { result } = renderHook(() =>
			useGitHubImportSelection('9,7,8', [repositorySeven, repositoryEight])
		)

		act(() => result.current.selectAllLoaded())

		expect(applyLatestSearch({ q: 'notes' })).toEqual({
			q: 'notes',
			selectedRepositoryIds: '9',
		})
	})

	test('resolves selected repositories from loaded data then the session cache', () => {
		const updatedRepositorySeven = {
			...repositorySeven,
			name: 'notes-renamed',
			fullName: 'marta/notes-renamed',
		}
		const rendered = renderHook(
			({ loadedRepositories }) =>
				useGitHubImportSelection('7', loadedRepositories),
			{ initialProps: { loadedRepositories: [repositorySeven] } }
		)

		expect(rendered.result.current.selectedRepositories).toEqual([
			repositorySeven,
		])
		act(() => rendered.result.current.toggleRepository('7'))

		rendered.rerender({ loadedRepositories: [updatedRepositorySeven] })
		expect(rendered.result.current.selectedRepositories).toEqual([
			updatedRepositorySeven,
		])

		rendered.rerender({ loadedRepositories: [repositoryEight] })
		expect(rendered.result.current.selectedRepositories).toEqual([
			repositorySeven,
		])
	})

	test('keeps unknown ids selected without resolving repository objects', () => {
		const { result } = renderHook(() =>
			useGitHubImportSelection('404', [repositorySeven])
		)

		expect(result.current.selectedRepositoryIds).toEqual(['404'])
		expect(result.current.selectedRepositories).toEqual([])
	})

	test('deduplicates ids parsed from the URL', () => {
		const { result } = renderHook(() =>
			useGitHubImportSelection('7,7', [repositorySeven])
		)

		expect(result.current.selectedRepositoryIds).toEqual(['7'])
		expect(result.current.selectedRepositories).toEqual([repositorySeven])
	})
})
