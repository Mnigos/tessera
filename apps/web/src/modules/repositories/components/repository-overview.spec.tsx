import type {
	RepositoryBrowserSummary,
	RepositoryExternalSource,
} from '@repo/contracts'
import { toast } from '@repo/ui/components/sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import {
	getRepositoryHttpCloneUrl,
	getRepositorySshCloneUrl,
} from '../helpers/get-repository-clone-url'
import {
	getFallbackRefOptions,
	getSelectedRepositoryQualifiedRef,
	getSelectedRepositoryRefOption,
} from '../helpers/repository-refs'
import { useSyncGitHubMirrorMutation } from '../hooks/use-sync-github-mirror.mutation'
import { RepositoryOverview } from './repository-overview'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params?: Record<string, string>
		to: string
	}) => {
		const href = params
			? to
					.replace('$username', params.username)
					.replace('$slug', params.slug)
					.replace('$ref', encodeURIComponent(params.ref))
			: to

		return (
			<a href={href} {...props}>
				{children}
			</a>
		)
	},
	useNavigate: () => vi.fn(),
}))

vi.mock('@repo/ui/components/sonner', async importOriginal => {
	const actual =
		await importOriginal<typeof import('@repo/ui/components/sonner')>()

	return {
		...actual,
		toast: {
			error: vi.fn(),
		},
	}
})

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(),
	useQueryClient: vi.fn(),
}))

vi.mock('../helpers/get-repository-clone-url', () => ({
	getRepositoryHttpCloneUrl: vi.fn(),
	getRepositorySshCloneUrl: vi.fn(),
}))

vi.mock('../hooks/use-sync-github-mirror.mutation', () => ({
	useSyncGitHubMirrorMutation: vi.fn(),
}))

const getRepositoryHttpCloneUrlMock = vi.mocked(getRepositoryHttpCloneUrl)
const getRepositorySshCloneUrlMock = vi.mocked(getRepositorySshCloneUrl)
const useSyncGitHubMirrorMutationMock = vi.mocked(useSyncGitHubMirrorMutation)
const useMutationMock = vi.mocked(useMutation)
const useQueryClientMock = vi.mocked(useQueryClient)

const baseSummary = {
	repository: {
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08' as RepositoryBrowserSummary['repository']['id'],
		slug: 'tessera-notes' as RepositoryBrowserSummary['repository']['slug'],
		name: 'Tessera Notes',
		visibility: 'public',
		description: 'Repository overview fixtures',
		defaultBranch: 'main',
		externalSource: { mode: 'none' },
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	},
	owner: {
		username: 'mnigos',
	},
	defaultBranch: 'main',
	branches: [
		{
			type: 'branch',
			name: 'main',
			qualifiedName: 'refs/heads/main',
			target: 'commit-main',
		},
		{
			type: 'branch',
			name: 'feature/browser-ref-selector',
			qualifiedName: 'refs/heads/feature/browser-ref-selector',
			target: 'commit-feature',
		},
	],
	tags: [
		{
			type: 'tag',
			name: 'v1.0.0',
			qualifiedName: 'refs/tags/v1.0.0',
			target: 'commit-release',
			signature: {
				state: 'unknown',
				keyId: '8CFDE12197965A9A',
			},
		},
	],
	isEmpty: false,
	rootEntries: [
		{
			name: 'src',
			objectId: 'tree-src',
			kind: 'directory',
			sizeBytes: 0,
			path: 'src',
			mode: '040000',
		},
		{
			name: 'package.json',
			objectId: 'blob-package-json',
			kind: 'file',
			sizeBytes: 1540,
			path: 'package.json',
			mode: '100644',
		},
		{
			name: 'latest',
			objectId: 'symlink-latest',
			kind: 'symlink',
			sizeBytes: 24,
			path: 'latest',
			mode: '120000',
		},
	],
} satisfies RepositoryBrowserSummary

const expectedCloneUrl = 'http://git.localhost/mnigos/tessera-notes.git'
const expectedSshCloneUrl = 'ssh://git@localhost:2222/mnigos/tessera-notes.git'

const README_HEADING_REGEX = /readme/i
const README_TRUNCATED_REGEX = /README preview is truncated/i
const cutoverGitHubMirrorMutateMock = vi.fn()
const syncGitHubMirrorMutateMock = vi.fn()

type RepositoryExternalSourceWithSchedule = Exclude<
	RepositoryExternalSource,
	{ mode: 'none' }
> & {
	nextSyncAt?: Date | number | string
}

function getSummary(
	overrides: Partial<RepositoryBrowserSummary> = {}
): RepositoryBrowserSummary {
	return {
		...baseSummary,
		...overrides,
		repository: {
			...baseSummary.repository,
			...overrides.repository,
		},
		owner: {
			...baseSummary.owner,
			...overrides.owner,
		},
	} as RepositoryBrowserSummary
}

function getMirroredSummary(
	overrides: Partial<RepositoryExternalSourceWithSchedule> = {}
) {
	const summary = getSummary()
	const externalSource: RepositoryExternalSourceWithSchedule = {
		mode: 'github_to_tessera',
		provider: 'github',
		externalRepositoryId: '123456',
		ownerLogin: 'mnigos',
		name: 'upstream-notes',
		fullName: 'mnigos/upstream-notes',
		sourceUrl: 'https://github.com/mnigos/upstream-notes',
		sourceDefaultBranch: 'main',
		syncStatus: 'succeeded',
		lastSyncStartedAt: new Date('2026-06-15T10:00:00.000Z'),
		lastSyncSucceededAt: new Date('2026-06-15T10:01:00.000Z'),
		lastSyncFailedAt: new Date('2026-06-14T09:00:00.000Z'),
		createdAt: new Date('2026-06-01T00:00:00.000Z'),
		updatedAt: new Date('2026-06-15T10:01:00.000Z'),
		...overrides,
	}

	return {
		...summary,
		repository: {
			...summary.repository,
			externalSource,
		},
	}
}

describe('RepositoryOverview', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		cutoverGitHubMirrorMutateMock.mockClear()
		syncGitHubMirrorMutateMock.mockClear()
	})

	beforeEach(() => {
		getRepositoryHttpCloneUrlMock.mockReturnValue(expectedCloneUrl)
		getRepositorySshCloneUrlMock.mockReturnValue(expectedSshCloneUrl)
		useQueryClientMock.mockReturnValue({
			invalidateQueries: vi.fn(),
		} as unknown as ReturnType<typeof useQueryClient>)
		useMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: cutoverGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useMutation>)
		useSyncGitHubMirrorMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: syncGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useSyncGitHubMirrorMutation>)
	})

	test('renders README markdown before the root tree when README is present', () => {
		render(
			<RepositoryOverview
				summary={getSummary({
					readme: {
						filename: 'README.md',
						objectId: 'readme-object',
						content:
							'# Tessera Notes\n\nUse this repository for planning.\n\n- Clone\n- Push',
						isTruncated: true,
					},
				})}
			/>
		)

		expect(screen.getByRole('heading', { name: 'README.md' })).toBeTruthy()
		expect(screen.getByText('mnigos/tessera-notes')).toBeTruthy()
		expect(screen.getByText('Use this repository for planning.')).toBeTruthy()
		expect(screen.getByText('README preview is truncated.')).toBeTruthy()

		const headings = screen.getAllByRole('heading')
		expect(
			headings.indexOf(screen.getByRole('heading', { name: 'README.md' }))
		).toBeLessThan(
			headings.indexOf(screen.getByRole('heading', { name: 'Files' }))
		)
	})

	test('collapses and expands the README preview', async () => {
		const user = userEvent.setup()

		render(
			<RepositoryOverview
				summary={getSummary({
					readme: {
						filename: 'README.md',
						objectId: 'readme-object',
						content: '# Getting Started\n\nPush the first branch.',
						isTruncated: false,
					},
				})}
			/>
		)

		expect(screen.getByText('Push the first branch.')).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Collapse README' }))

		expect(screen.queryByText('Push the first branch.')).toBeNull()

		await user.click(screen.getByRole('button', { name: 'Expand README' }))

		expect(screen.getByText('Push the first branch.')).toBeTruthy()
	})

	test('shows the file tree first without a large missing README placeholder', () => {
		render(<RepositoryOverview summary={getSummary()} />)

		expect(
			screen.queryByRole('heading', { name: README_HEADING_REGEX })
		).toBeNull()
		expect(screen.queryByText(README_TRUNCATED_REGEX)).toBeNull()
		expect(screen.getByRole('heading', { name: 'Files' })).toBeTruthy()
		expect(screen.getByText('src')).toBeTruthy()
		expect(screen.getByText('package.json')).toBeTruthy()
	})

	test('shows SSH and HTTPS clone URLs for non-empty repositories', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		const user = userEvent.setup()

		render(<RepositoryOverview summary={getSummary()} />)

		expect(screen.getByRole('heading', { name: 'Clone' })).toBeTruthy()
		expect(screen.getByText(expectedSshCloneUrl)).toBeTruthy()
		expect(screen.getByText(expectedCloneUrl)).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Copy SSH clone URL' }))

		expect(writeTextSpy).toHaveBeenCalledWith(expectedSshCloneUrl)
		expect(
			screen.getByRole('button', { name: 'SSH clone URL copied' })
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Copy HTTPS clone URL' })
		)

		expect(writeTextSpy).toHaveBeenCalledWith(expectedCloneUrl)
		expect(
			screen.getByRole('button', { name: 'HTTPS clone URL copied' })
		).toBeTruthy()
	})

	test('shows GitHub mirror source state and sync timestamps', () => {
		const summary = getMirroredSummary()
		const formatter = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		})

		render(<RepositoryOverview isCurrentOwner summary={summary} />)

		expect(screen.getByRole('heading', { name: 'GitHub mirror' })).toBeTruthy()
		expect(screen.getAllByText('mnigos/upstream-notes')).toBeTruthy()
		expect(
			screen.getByRole('link', {
				name: 'https://github.com/mnigos/upstream-notes',
			})
		).toBeTruthy()
		expect(screen.getByText('Succeeded')).toBeTruthy()
		expect(screen.getByText('Last started')).toBeTruthy()
		expect(
			screen.getByText(formatter.format(new Date('2026-06-15T10:00:00.000Z')))
		).toBeTruthy()
		expect(screen.getByText('Last success')).toBeTruthy()
		expect(
			screen.getByText(formatter.format(new Date('2026-06-15T10:01:00.000Z')))
		).toBeTruthy()
		expect(screen.getByText('Last failure')).toBeTruthy()
		expect(
			screen.getByText(formatter.format(new Date('2026-06-14T09:00:00.000Z')))
		).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy()
	})

	test('shows the next scheduled GitHub mirror sync when present', () => {
		const formatter = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		})

		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({
					nextSyncAt: new Date('2026-06-16T10:00:00.000Z'),
				})}
			/>
		)

		expect(screen.getByText('Next scheduled')).toBeTruthy()
		expect(
			screen.getByText(formatter.format(new Date('2026-06-16T10:00:00.000Z')))
		).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy()
	})

	test('renders serialized GitHub mirror timestamps defensively', () => {
		const formatter = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		})

		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({
					lastSyncFailedAt: undefined,
					lastSyncStartedAt: '2026-06-15T10:00:00.000Z' as unknown as Date,
					lastSyncSucceededAt: 'not-a-date' as unknown as Date,
				})}
			/>
		)

		expect(
			screen.getByText(formatter.format(new Date('2026-06-15T10:00:00.000Z')))
		).toBeTruthy()
		expect(screen.getAllByText('Never')).toHaveLength(2)
	})

	test('queues manual GitHub mirror sync for the current owner', async () => {
		const user = userEvent.setup()

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		await user.click(screen.getByRole('button', { name: 'Sync now' }))

		expect(syncGitHubMirrorMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	test('hides manual GitHub mirror sync for non-owner users', () => {
		render(<RepositoryOverview summary={getMirroredSummary()} />)

		expect(screen.getByText('mnigos/upstream-notes')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
	})

	test.each([
		'pending',
		'running',
	] as const)('disables manual GitHub mirror sync while status is %s', status => {
		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({ syncStatus: status })}
			/>
		)

		expect(
			screen.getByText(status === 'pending' ? 'Pending' : 'Running')
		).toBeTruthy()
		expect(screen.getByText(`Sync is ${status}.`)).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Sync now' }).hasAttribute('disabled')
		).toBe(true)
	})

	test('shows GitHub mirror failure state and reason', () => {
		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({
					syncStatus: 'failed',
					syncFailureReason: 'GitHub source could not be fetched.',
				})}
			/>
		)

		expect(screen.getByText('Failed')).toBeTruthy()
		expect(screen.getByText('GitHub source could not be fetched.')).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Sync now' }).hasAttribute('disabled')
		).toBe(false)
		expect(screen.queryByText('Cut over writes to Tessera')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review cutover' })).toBeNull()
	})

	test('does not show next scheduled sync for failed mirrors without nextSyncAt', () => {
		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({
					syncStatus: 'failed',
					syncFailureReason: 'GitHub auth must be reconnected.',
				})}
			/>
		)

		expect(screen.getByText('Failed')).toBeTruthy()
		expect(screen.getByText('GitHub auth must be reconnected.')).toBeTruthy()
		expect(screen.queryByText('Next scheduled')).toBeNull()
		expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy()
		expect(screen.queryByText('Cut over writes to Tessera')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review cutover' })).toBeNull()
	})

	test('shows manual GitHub mirror sync pending and success states', () => {
		useSyncGitHubMirrorMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: true,
			isSuccess: true,
			mutate: syncGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useSyncGitHubMirrorMutation>)

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		expect(
			screen
				.getByRole('button', { name: 'Syncing...' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(screen.getByText('Sync queued.')).toBeTruthy()
	})

	test('shows manual GitHub mirror sync mutation errors', () => {
		useSyncGitHubMirrorMutationMock.mockReturnValue({
			error: new Error('queue unavailable'),
			isError: true,
			isPending: false,
			isSuccess: false,
			mutate: syncGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useSyncGitHubMirrorMutation>)

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		expect(
			screen.getByText('GitHub mirror sync could not be queued.')
		).toBeTruthy()
	})

	test('shows owner cutover entry point with source identity, warning, checklist, and commands', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		const user = userEvent.setup()

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		expect(screen.getByText('Cut over writes to Tessera')).toBeTruthy()
		expect(
			screen.getByText(
				'After confirmation, Tessera becomes the source of truth for mnigos/upstream-notes. Pushes should target Tessera remotes, not GitHub.'
			)
		).toBeTruthy()
		expect(
			screen.getByText('Migration guide: docs/github-cutover.md')
		).toBeTruthy()
		expect(
			screen.queryByRole('link', { name: 'Read migration guide' })
		).toBeNull()
		expect(screen.getAllByText('GitHub source')).toBeTruthy()
		expect(screen.getByText('Default branch')).toBeTruthy()
		expect(screen.getByText('Update local remotes to Tessera.')).toBeTruthy()
		expect(
			screen.getByText('Run fetch verification after switching remotes.')
		).toBeTruthy()
		expect(
			screen.getByText('Notify teammates before they push more work.')
		).toBeTruthy()
		expect(
			screen.getByText('Confirm GitHub mirror status is succeeded.')
		).toBeTruthy()
		expect(
			screen.getByText(`git remote set-url origin ${expectedCloneUrl}`)
		).toBeTruthy()
		expect(
			screen.getByText(`git remote set-url origin ${expectedSshCloneUrl}`)
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Copy HTTPS remote command' })
		)

		expect(writeTextSpy).toHaveBeenCalledWith(
			`git remote set-url origin ${expectedCloneUrl}`
		)
	})

	test.each([
		'pending',
		'running',
	] as const)('disables GitHub mirror cutover while status is %s', async status => {
		const user = userEvent.setup()

		render(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({ syncStatus: status })}
			/>
		)

		expect(
			screen.getByText(`Cutover is unavailable while sync is ${status}.`)
		).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Review cutover' }))

		expect(
			screen.queryByRole('button', { name: 'Confirm checklist' })
		).toBeNull()
		expect(cutoverGitHubMirrorMutateMock).not.toHaveBeenCalled()
	})

	test('confirms and submits GitHub mirror cutover for the current owner', async () => {
		const user = userEvent.setup()

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		await user.click(screen.getByRole('button', { name: 'Review cutover' }))

		expect(
			screen
				.getByRole('button', { name: 'Cut over to Tessera' })
				.hasAttribute('disabled')
		).toBe(true)

		fireEvent.click(screen.getByRole('checkbox'))
		await waitFor(() =>
			expect(
				screen
					.getByRole('button', { name: 'Cut over to Tessera' })
					.hasAttribute('disabled')
			).toBe(false)
		)
		await user.click(
			screen.getByRole('button', { name: 'Cut over to Tessera' })
		)

		expect(cutoverGitHubMirrorMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	test('blocks GitHub mirror cutover submission when sync locks after confirmation', async () => {
		const user = userEvent.setup()
		const { rerender } = render(
			<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />
		)

		await user.click(screen.getByRole('button', { name: 'Review cutover' }))
		fireEvent.click(screen.getByRole('checkbox'))

		rerender(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({ syncStatus: 'running' })}
			/>
		)

		expect(
			screen.getByText('Cutover is unavailable while sync is running.')
		).toBeTruthy()
		expect(
			screen
				.getByRole('button', { name: 'Cut over to Tessera' })
				.hasAttribute('disabled')
		).toBe(true)

		await user.click(
			screen.getByRole('button', { name: 'Cut over to Tessera' })
		)

		expect(cutoverGitHubMirrorMutateMock).not.toHaveBeenCalled()
	})

	test('shows GitHub mirror cutover loading, success, and error states', async () => {
		useMutationMock.mockReturnValue({
			error: new Error('cutover unavailable'),
			isError: true,
			isPending: true,
			isSuccess: true,
			mutate: cutoverGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useMutation>)
		const user = userEvent.setup()

		render(<RepositoryOverview isCurrentOwner summary={getMirroredSummary()} />)

		await user.click(screen.getByRole('button', { name: 'Review cutover' }))

		expect(
			screen
				.getByRole('button', { name: 'Cutting over...' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(
			screen.getByText('Cutover complete. Tessera is source of truth.')
		).toBeTruthy()
		expect(
			screen.getByText('GitHub mirror cutover could not be completed.')
		).toBeTruthy()
	})

	test('hides pre-cutover action for non-owner users and already cut-over repositories', () => {
		const cutoverAt = new Date('2026-06-17T12:00:00.000Z')
		const formatter = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		})

		const { rerender } = render(
			<RepositoryOverview summary={getMirroredSummary()} />
		)

		expect(screen.queryByText('Cut over writes to Tessera')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review cutover' })).toBeNull()

		rerender(
			<RepositoryOverview
				isCurrentOwner
				summary={getMirroredSummary({
					cutoverAt,
					cutoverFromMirrorMode: 'github_to_tessera',
					mode: 'tessera_source',
				})}
			/>
		)

		expect(
			screen.getByRole('heading', { name: 'Repository source' })
		).toBeTruthy()
		expect(screen.getByText('Tessera source of truth')).toBeTruthy()
		expect(
			screen.getByText(
				'GitHub mirror controls are hidden because writes now belong in Tessera.'
			)
		).toBeTruthy()
		expect(screen.getByText(formatter.format(cutoverAt))).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review cutover' })).toBeNull()
	})

	test('shows a non-mirrored fallback', () => {
		render(<RepositoryOverview isCurrentOwner summary={getSummary()} />)

		expect(screen.getByRole('heading', { name: 'GitHub mirror' })).toBeTruthy()
		expect(
			screen.getByText('This repository is not mirrored from GitHub.')
		).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
	})

	test('distinguishes directory and file rows', () => {
		render(<RepositoryOverview summary={getSummary()} />)

		const rows = screen.getAllByTestId('file-tree-row')
		const srcRow = rows.find(row => row.dataset.entryName === 'src')
		const packageRow = rows.find(
			row => row.dataset.entryName === 'package.json'
		)

		expect(srcRow).toBeTruthy()
		expect(packageRow).toBeTruthy()
		expect(within(srcRow as HTMLElement).getByText('directory')).toBeTruthy()
		expect(within(srcRow as HTMLElement).getByText('-')).toBeTruthy()
		expect(within(packageRow as HTMLElement).getByText('file')).toBeTruthy()
		expect(within(packageRow as HTMLElement).getByText('1.5 KB')).toBeTruthy()
	})

	test('links root rows to tree and blob routes', () => {
		render(<RepositoryOverview summary={getSummary()} />)

		const rows = screen.getAllByTestId('file-tree-row')
		const srcRow = rows.find(row => row.dataset.entryName === 'src')
		const packageRow = rows.find(
			row => row.dataset.entryName === 'package.json'
		)
		const symlinkRow = rows.find(row => row.dataset.entryName === 'latest')

		expect(symlinkRow).toBeTruthy()
		expect(srcRow?.getAttribute('href')).toBe(
			'/mnigos/tessera-notes/tree/refs%2Fheads%2Fmain/src'
		)
		expect(packageRow?.getAttribute('href')).toBe(
			'/mnigos/tessera-notes/blob/refs%2Fheads%2Fmain/package.json'
		)
		expect(symlinkRow?.getAttribute('href')).toBeNull()
		expect(within(symlinkRow as HTMLElement).getByText('symlink')).toBeTruthy()
		expect(within(symlinkRow as HTMLElement).getByText('24 B')).toBeTruthy()
	})

	test('links to commit history for the default branch', () => {
		render(<RepositoryOverview summary={getSummary()} />)

		expect(
			screen
				.getByRole('link', { name: 'View commits for main' })
				.getAttribute('href')
		).toBe('/mnigos/tessera-notes/commits/refs%2Fheads%2Fmain')
	})

	test('prefers API-normalized selected refs over raw search refs', () => {
		render(
			<RepositoryOverview
				selectedRef="release"
				summary={getSummary({
					selectedRef: {
						type: 'tag',
						name: 'release',
						qualifiedName: 'refs/tags/release',
						target: 'commit-release',
						signature: {
							state: 'valid',
							signer: 'Release Bot',
						},
					},
				})}
			/>
		)

		expect(
			screen
				.getByRole('link', { name: 'View commits for release' })
				.getAttribute('href')
		).toBe('/mnigos/tessera-notes/commits/refs%2Ftags%2Frelease')
	})

	test('qualifies bare selected refs from discovered refs', () => {
		expect(
			getSelectedRepositoryQualifiedRef({
				defaultBranch: 'main',
				selectedRef: 'v1.0.0',
				summary: getSummary(),
			})
		).toBe('refs/tags/v1.0.0')
		expect(
			getSelectedRepositoryQualifiedRef({
				defaultBranch: 'main',
				selectedRef: 'feature/browser-ref-selector',
				summary: getSummary(),
			})
		).toBe('refs/heads/feature/browser-ref-selector')
	})

	test('uses tag kind for qualified fallback tag refs', () => {
		expect(getFallbackRefOptions('refs/tags/v1.0.0')).toEqual([
			{
				kind: 'tag',
				name: 'v1.0.0',
				qualifiedName: 'refs/tags/v1.0.0',
			},
		])
	})

	test('qualifies bare fallback branch refs', () => {
		expect(getFallbackRefOptions('main')).toEqual([
			{
				kind: 'branch',
				name: 'main',
				qualifiedName: 'refs/heads/main',
			},
		])
	})

	test('selects qualified ref options for bare refs', () => {
		expect(
			getSelectedRepositoryRefOption({
				refName: 'main',
				refs: [
					{
						kind: 'branch',
						name: 'main',
						qualifiedName: 'refs/heads/main',
					},
				],
			})
		).toBe('refs/heads/main')
	})

	test('shows a grouped branch and tag selector with default branch selected', async () => {
		const user = userEvent.setup()

		render(<RepositoryOverview summary={getSummary()} />)

		expect(
			screen.getByRole('combobox', { name: 'Repository ref' }).textContent
		).toContain('main')

		await user.click(screen.getByRole('combobox', { name: 'Repository ref' }))

		expect(screen.getByText('Branches')).toBeTruthy()
		expect(screen.getByText('Tags')).toBeTruthy()
		expect(screen.getByText('feature/browser-ref-selector')).toBeTruthy()
		expect(screen.getByText('v1.0.0')).toBeTruthy()
		expect(screen.getByText('Unknown')).toBeTruthy()
		expect(
			screen
				.getByText('Unknown')
				.closest('[title="Unknown signer: 8CFDE12197965A9A"]')
		).toBeTruthy()
	})

	test('shows clone and push commands for an empty repository', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		const user = userEvent.setup()

		render(
			<RepositoryOverview
				summary={getSummary({
					isEmpty: true,
					rootEntries: [],
					readme: undefined,
				})}
			/>
		)

		expect(
			screen.getByRole('heading', { name: 'Empty repository' })
		).toBeTruthy()
		expect(
			screen.getByText(
				'Clone it locally or push an existing project to publish the first commit.'
			)
		).toBeTruthy()
		expect(screen.getByText(`git clone ${expectedSshCloneUrl}`)).toBeTruthy()
		const setupCommands = [
			`git remote add origin ${expectedSshCloneUrl}`,
			'git branch -M main',
			'git push -u origin main',
		].join('\n')
		expect(
			screen.getAllByText(
				(_, element) => element?.textContent === setupCommands
			)
		).toBeTruthy()
		expect(screen.getByText(expectedCloneUrl)).toBeTruthy()
		expect(
			screen
				.getByRole('combobox', { name: 'Repository ref' })
				.hasAttribute('disabled')
		).toBe(true)

		await user.click(screen.getByRole('button', { name: 'Copy SSH clone URL' }))

		expect(writeTextSpy).toHaveBeenCalledWith(expectedSshCloneUrl)
		expect(
			screen.getByRole('button', { name: 'SSH clone URL copied' })
		).toBeTruthy()
		expect(screen.getByText('SSH clone URL copied')).toBeTruthy()
	})

	test('copies empty repository setup command blocks', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		const user = userEvent.setup()

		render(
			<RepositoryOverview
				summary={getSummary({
					isEmpty: true,
					rootEntries: [],
					readme: undefined,
				})}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Copy clone command' }))

		expect(writeTextSpy).toHaveBeenCalledWith(
			`git clone ${expectedSshCloneUrl}`
		)

		await user.click(
			screen.getByRole('button', { name: 'Copy setup commands' })
		)

		expect(writeTextSpy).toHaveBeenCalledWith(
			[
				`git remote add origin ${expectedSshCloneUrl}`,
				'git branch -M main',
				'git push -u origin main',
			].join('\n')
		)
	})

	test('shows copy failure feedback for empty repositories', async () => {
		const error = new Error('clipboard unavailable')
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined)
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(error)
		const user = userEvent.setup()

		render(
			<RepositoryOverview
				summary={getSummary({
					isEmpty: true,
					rootEntries: [],
					readme: undefined,
				})}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Copy SSH clone URL' }))

		expect(consoleErrorSpy).toHaveBeenCalledWith(error)
		expect(toast.error).toHaveBeenCalledWith('Could not copy clone URL')
	})
})
