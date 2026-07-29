import type {
	RepositoryBrowserSummary,
	RepositoryExternalSource,
} from '@repo/contracts'
import { toast } from '@repo/ui/components/sonner'
import { render, screen, within } from '@testing-library/react'
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
import { useCutoverGitHubMirrorMutation } from '../hooks/use-cutover-github-mirror.mutation'
import { useEnableGitHubMirrorMutation } from '../hooks/use-enable-github-mirror.mutation'
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

vi.mock('../helpers/get-repository-clone-url', () => ({
	getRepositoryHttpCloneUrl: vi.fn(),
	getRepositorySshCloneUrl: vi.fn(),
}))

vi.mock('../hooks/use-cutover-github-mirror.mutation', () => ({
	useCutoverGitHubMirrorMutation: vi.fn(),
}))

vi.mock('../hooks/use-enable-github-mirror.mutation', () => ({
	useEnableGitHubMirrorMutation: vi.fn(),
}))

const getRepositoryHttpCloneUrlMock = vi.mocked(getRepositoryHttpCloneUrl)
const getRepositorySshCloneUrlMock = vi.mocked(getRepositorySshCloneUrl)
const useCutoverGitHubMirrorMutationMock = vi.mocked(
	useCutoverGitHubMirrorMutation
)
const useEnableGitHubMirrorMutationMock = vi.mocked(
	useEnableGitHubMirrorMutation
)

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
	viewerRole: 'read',
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
const GITHUB_REPOSITORY_REGEX = /mnigos\/upstream-notes/
const MIRROR_BUTTON_REGEX = /mirror/i
const SYNC_BUTTON_REGEX = /Sync/
const SYNC_FAILED_REGEX = /Sync failed ·/
const SYNCED_REGEX = /Synced ·/
const cutoverGitHubMirrorMutateMock = vi.fn()
const enableGitHubMirrorMutateMock = vi.fn()

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

function asOwner<T>(summary: T): T & { viewerRole: 'owner' } {
	return { ...summary, viewerRole: 'owner' }
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

function getTesseraSourceSummary(
	overrides: Partial<RepositoryExternalSourceWithSchedule> = {}
) {
	return getMirroredSummary({
		cutoverAt: new Date('2026-06-17T12:00:00.000Z'),
		cutoverFromMirrorMode: 'github_to_tessera',
		githubPushBackEnabled: false,
		githubPushBackStatus: 'idle',
		mode: 'tessera_source',
		...overrides,
	})
}

describe('RepositoryOverview', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		cutoverGitHubMirrorMutateMock.mockClear()
		enableGitHubMirrorMutateMock.mockClear()
	})

	beforeEach(() => {
		getRepositoryHttpCloneUrlMock.mockReturnValue(expectedCloneUrl)
		getRepositorySshCloneUrlMock.mockReturnValue(expectedSshCloneUrl)
		useCutoverGitHubMirrorMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: cutoverGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useCutoverGitHubMirrorMutation>)
		useEnableGitHubMirrorMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: enableGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useEnableGitHubMirrorMutation>)
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

	test('shows imported GitHub provenance and lets the owner enable automatic mirroring', async () => {
		const user = userEvent.setup()
		const summary = getMirroredSummary({ mode: 'imported' })

		render(<RepositoryOverview summary={asOwner(summary)} />)

		expect(
			screen.getByRole('heading', { name: 'Not mirrored to GitHub' })
		).toBeTruthy()
		expect(
			screen.getByText(
				'Connect the GitHub App to keep a mirror in sync automatically.'
			)
		).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Enable mirror' }))

		expect(enableGitHubMirrorMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	test('hides automatic mirror enablement from non-owners', () => {
		render(
			<RepositoryOverview summary={getMirroredSummary({ mode: 'imported' })} />
		)

		expect(screen.getByText('Not mirrored to GitHub')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Enable mirror' })).toBeNull()
	})

	test('shows compact GitHub-to-Tessera status with accessible freshness', () => {
		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()
		expect(screen.getByText('GitHub → Tessera')).toBeTruthy()
		expect(screen.getByText(SYNCED_REGEX)).toBeTruthy()
		expect(screen.getByRole('time').getAttribute('datetime')).toBe(
			'2026-06-15T10:01:00.000Z'
		)
		expect(screen.getByRole('time').getAttribute('title')).toBeTruthy()
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
	})

	test.each([
		['pending', 'Sync queued'],
		['running', 'Syncing…'],
		['blocked', 'Sync blocked'],
	] as const)('shows automatic mirror status %s', (syncStatus, label) => {
		render(
			<RepositoryOverview
				summary={asOwner(getMirroredSummary({ syncStatus }))}
			/>
		)

		expect(screen.getByText(new RegExp(label))).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: 'Make Tessera authoritative' })
		).toBeNull()
	})

	test('shows an actionable automatic mirror failure', () => {
		render(
			<RepositoryOverview
				summary={asOwner(
					getMirroredSummary({
						syncStatus: 'failed',
						syncFailureReason:
							'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.',
					})
				)}
			/>
		)

		expect(screen.getByText(SYNC_FAILED_REGEX)).toBeTruthy()
		expect(
			screen.getByText(
				'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.'
			)
		).toBeTruthy()
	})

	test('confirms the owner-only authority change before cutover', async () => {
		const user = userEvent.setup()

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		await user.click(
			screen.getByRole('button', { name: 'Make Tessera authoritative' })
		)

		expect(
			screen.getByText(
				'This stops GitHub-to-Tessera synchronization. Future writes must target Tessera.'
			)
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Confirm authority change' })
		)

		expect(cutoverGitHubMirrorMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	test('hides authority changes from non-owners', () => {
		render(<RepositoryOverview summary={getMirroredSummary()} />)

		expect(
			screen.queryByRole('button', { name: 'Make Tessera authoritative' })
		).toBeNull()
	})

	test('shows cutover mutation feedback', () => {
		useCutoverGitHubMirrorMutationMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			isSuccess: true,
			mutate: cutoverGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useCutoverGitHubMirrorMutation>)

		const { rerender } = render(
			<RepositoryOverview summary={asOwner(getMirroredSummary())} />
		)

		expect(screen.getByText('Tessera is now authoritative.')).toBeTruthy()

		useCutoverGitHubMirrorMutationMock.mockReturnValue({
			error: new Error('cutover unavailable'),
			isError: true,
			isPending: false,
			isSuccess: false,
			mutate: cutoverGitHubMirrorMutateMock,
		} as unknown as ReturnType<typeof useCutoverGitHubMirrorMutation>)

		rerender(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(
			screen.getByText('Authority could not be changed. Try again.')
		).toBeTruthy()
	})

	test('shows Tessera authority with historical GitHub provenance and no controls', () => {
		render(<RepositoryOverview summary={asOwner(getTesseraSourceSummary())} />)

		expect(
			screen.getByRole('heading', { name: 'Tessera is authoritative' })
		).toBeTruthy()
		expect(screen.getByText('Tessera source')).toBeTruthy()
		expect(screen.getByText('Formerly mirrored from')).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: MIRROR_BUTTON_REGEX })
		).toBeNull()
	})

	test('does not show a source strip for native Tessera repositories', () => {
		render(<RepositoryOverview summary={asOwner(getSummary())} />)

		expect(screen.queryByText('GitHub → Tessera')).toBeNull()
		expect(screen.queryByText('Not mirrored to GitHub')).toBeNull()
		expect(screen.queryByText('Tessera is authoritative')).toBeNull()
	})

	test.each([
		'owner',
		'admin',
	] as const)('shows the collaborators settings link for %s viewers', viewerRole => {
		render(<RepositoryOverview summary={getSummary({ viewerRole })} />)

		expect(
			screen.getByRole('link', { name: 'Collaborators' }).getAttribute('href')
		).toBe('/mnigos/tessera-notes/settings/collaborators')
	})

	test.each([
		'write',
		'read',
	] as const)('hides the collaborators settings link for %s viewers', viewerRole => {
		render(<RepositoryOverview summary={getSummary({ viewerRole })} />)

		expect(screen.queryByRole('link', { name: 'Collaborators' })).toBeNull()
	})

	test('hides owner-only GitHub mirror controls for admin viewers', () => {
		render(
			<RepositoryOverview
				summary={{ ...getMirroredSummary(), viewerRole: 'admin' }}
			/>
		)

		expect(screen.getByText('mnigos/upstream-notes')).toBeTruthy()
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
