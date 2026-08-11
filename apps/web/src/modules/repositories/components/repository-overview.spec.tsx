import type {
	RepositoryBrowserSummary,
	RepositoryExternalSource,
	RepositorySyncHealth,
} from '@repo/contracts'
import { toast } from '@repo/ui/components/sonner'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import {
	getFallbackRefOptions,
	getSelectedRepositoryQualifiedRef,
	getSelectedRepositoryRefOption,
} from '../helpers/repository-refs'
import { useGitHubSyncHealthQuery } from '../hooks/use-github-sync-health.query'
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

vi.mock('../hooks/use-github-sync-health.query', () => ({
	useGitHubSyncHealthQuery: vi.fn(),
}))

const useGitHubSyncHealthQueryMock = vi.mocked(useGitHubSyncHealthQuery)

const baseSummary = {
	repository: {
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08' as RepositoryBrowserSummary['repository']['id'],
		slug: 'tessera-notes' as RepositoryBrowserSummary['repository']['slug'],
		name: 'Tessera Notes',
		visibility: 'public',
		description: 'Repository overview fixtures',
		defaultBranch: 'main',
		externalSource: { mode: 'none' },
		cloneUrls: {
			authority: 'tessera',
			https: 'https://git.localhost/mnigos/tessera-notes.git',
			ssh: 'ssh://git@localhost:2222/mnigos/tessera-notes.git',
		},
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

const expectedCloneUrl = 'https://git.localhost/mnigos/tessera-notes.git'
const expectedSshCloneUrl = 'ssh://git@localhost:2222/mnigos/tessera-notes.git'

const README_HEADING_REGEX = /readme/i
const README_TRUNCATED_REGEX = /README preview is truncated/i
const GITHUB_REPOSITORY_REGEX = /mnigos\/upstream-notes/
const MIRROR_BUTTON_REGEX = /mirror/i
const SYNC_BUTTON_REGEX = /sync/i
const AUTHORITY_BUTTON_REGEX = /authoritative/i

const GITHUB_CLONE_URLS = {
	authority: 'github',
	https: 'https://github.com/mnigos/upstream-notes.git',
	ssh: 'git@github.com:mnigos/upstream-notes.git',
} satisfies RepositoryBrowserSummary['repository']['cloneUrls']

const BASE_SYNC_HEALTH = {
	pendingDeliveryCount: 0,
	retryCount24h: 0,
	failureRate24h: 0,
	reauthorizationRequired: false,
} satisfies Omit<RepositorySyncHealth, 'state'>

function mockSyncHealth(syncHealth?: RepositorySyncHealth) {
	useGitHubSyncHealthQueryMock.mockReturnValue({
		data: syncHealth ? { syncHealth } : undefined,
		isError: false,
		isLoading: false,
	} as unknown as ReturnType<typeof useGitHubSyncHealthQuery>)
}

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
			// A mirrored repository is GitHub-authoritative, so its clone URLs are
			// GitHub's. Leaving Tessera URLs here would be a state the contract
			// never produces, and would hide a clone-panel regression.
			cloneUrls:
				externalSource.mode === 'github_to_tessera'
					? GITHUB_CLONE_URLS
					: summary.repository.cloneUrls,
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
	})

	beforeEach(() => {
		mockSyncHealth()
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

	test('states GitHub authority with a source link and no controls at all', () => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'healthy' })

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(screen.getByText('GitHub is the source of truth')).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()
		expect(screen.getByText('In sync')).toBeTruthy()
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_REGEX })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: MIRROR_BUTTON_REGEX })
		).toBeNull()
	})

	test('keeps a healthy mirror quiet, with no explanation and no settings link', () => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'healthy' })

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(screen.getByText('In sync')).toBeTruthy()
		expect(
			screen.queryByText('Everything GitHub has sent has been synchronized.')
		).toBeNull()
		expect(screen.queryByRole('link', { name: 'Sync details' })).toBeNull()
	})

	test.each([
		[
			'pending',
			'Sync in progress',
			'Synchronization is queued or in progress.',
		],
		[
			'stale',
			'Sync overdue',
			'Nothing has synchronized recently, so what is shown here may be behind GitHub.',
		],
		[
			'partial',
			'Partly synced',
			'Some GitHub updates are awaiting reconciliation, so data may be missing here.',
		],
		[
			'failed',
			'Sync failed',
			'The last synchronization did not finish. Tessera retries on its own.',
		],
		[
			'blocked',
			'Sync blocked',
			'Synchronization is stopped, so nothing new is arriving.',
		],
	] as const)('names the %s sync state in words and points the owner at the detail', (state, label, description) => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state })

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(screen.getByText(label)).toBeTruthy()
		expect(screen.getByText(description)).toBeTruthy()
		expect(
			screen.getByRole('link', { name: 'Sync details' }).getAttribute('href')
		).toBe('/mnigos/tessera-notes/settings/github')
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
	})

	test('reads a rate-limited mirror as waiting rather than broken', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'stale',
			code: 'rate_limited',
			rateLimitedUntil: new Date('2026-06-15T11:00:00.000Z'),
		})

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(screen.getByText('Waiting on GitHub')).toBeTruthy()
		expect(
			screen.getByText(
				"GitHub's rate limit is in effect. Synchronization resumes on its own once it resets."
			)
		).toBeTruthy()
		expect(screen.queryByText('Sync failed')).toBeNull()
		expect(screen.queryByText('Sync overdue')).toBeNull()
	})

	test('never asks for owner-only sync health on behalf of a non-owner', () => {
		render(<RepositoryOverview summary={getMirroredSummary()} />)

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			false
		)

		useGitHubSyncHealthQueryMock.mockClear()

		render(<RepositoryOverview summary={asOwner(getMirroredSummary())} />)

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			true
		)
	})

	test('does not ask for sync health on a repository with no running mirror', () => {
		render(<RepositoryOverview summary={asOwner(getTesseraSourceSummary())} />)

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			false
		)
	})

	test('states provenance without a sync state for viewers who cannot read health', () => {
		render(<RepositoryOverview summary={getMirroredSummary()} />)

		expect(screen.getByText('GitHub is the source of truth')).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()
		expect(screen.queryByText('In sync')).toBeNull()
		expect(screen.queryByRole('link', { name: 'Sync details' })).toBeNull()
	})

	test('offers GitHub clone URLs while GitHub is authoritative', () => {
		render(
			<RepositoryOverview
				summary={asOwner({
					...getMirroredSummary(),
					repository: {
						...getMirroredSummary().repository,
						cloneUrls: GITHUB_CLONE_URLS,
					},
				})}
			/>
		)

		expect(screen.getByText(GITHUB_CLONE_URLS.ssh)).toBeTruthy()
		expect(screen.getByText(GITHUB_CLONE_URLS.https)).toBeTruthy()
		expect(
			screen.getByText(
				'GitHub is the source of truth for this repository, so clones and pushes go to GitHub.'
			)
		).toBeTruthy()
		expect(screen.queryByText(expectedSshCloneUrl)).toBeNull()
	})

	// Labelling a plain-HTTP Enterprise remote "HTTPS" would be a security claim,
	// not a cosmetic one — in the label, the button name, and the confirmation.
	test('labels a plain-HTTP clone URL as HTTP everywhere it is named', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		const user = userEvent.setup()
		const mirrored = getMirroredSummary()
		const httpCloneUrls = {
			authority: 'github',
			https: 'http://github.acme.internal/mnigos/upstream-notes.git',
			ssh: 'git@github.acme.internal:mnigos/upstream-notes.git',
		} satisfies RepositoryBrowserSummary['repository']['cloneUrls']

		render(
			<RepositoryOverview
				summary={
					{
						...mirrored,
						repository: { ...mirrored.repository, cloneUrls: httpCloneUrls },
					} as RepositoryBrowserSummary
				}
			/>
		)

		expect(screen.getByText('HTTP')).toBeTruthy()
		expect(screen.queryByText('HTTPS')).toBeNull()
		// The description names the protocol too, so it cannot claim HTTPS either.
		expect(
			screen.queryByText(
				'Use SSH for authenticated Git access, or HTTPS when SSH is not available.'
			)
		).toBeNull()

		await user.click(
			screen.getByRole('button', { name: 'Copy HTTP clone URL' })
		)

		expect(writeTextSpy).toHaveBeenCalledWith(httpCloneUrls.https)
		expect(
			screen.getByRole('button', { name: 'HTTP clone URL copied' })
		).toBeTruthy()
	})

	test('offers Tessera clone URLs for an imported repository', () => {
		render(
			<RepositoryOverview
				summary={asOwner(getMirroredSummary({ mode: 'imported' }))}
			/>
		)

		expect(screen.getByText('Imported from GitHub')).toBeTruthy()
		expect(screen.getByText(expectedSshCloneUrl)).toBeTruthy()
		expect(screen.getByText(expectedCloneUrl)).toBeTruthy()
	})

	test('switches clone URLs back to Tessera after cutover', () => {
		render(<RepositoryOverview summary={asOwner(getTesseraSourceSummary())} />)

		expect(screen.getByText('Tessera is the source of truth')).toBeTruthy()
		expect(screen.getByText(expectedSshCloneUrl)).toBeTruthy()
		expect(screen.queryByText(GITHUB_CLONE_URLS.ssh)).toBeNull()
	})

	test('tells an empty GitHub-authoritative repository to push to GitHub', () => {
		const mirrored = getMirroredSummary()

		render(
			<RepositoryOverview
				summary={
					{
						...mirrored,
						isEmpty: true,
						rootEntries: [],
						readme: undefined,
						repository: {
							...mirrored.repository,
							cloneUrls: GITHUB_CLONE_URLS,
						},
					} as RepositoryBrowserSummary
				}
			/>
		)

		// Emptiness here means nothing has synchronized, which is not the same as
		// GitHub having nothing — an unfinished first run looks identical.
		expect(
			screen.getByRole('heading', { name: 'Nothing synchronized yet' })
		).toBeTruthy()
		expect(
			screen.getByText(
				'GitHub is the source of truth for this repository. Anything already on GitHub appears here once it synchronizes, and until the first push to GitHub there is nothing to show.'
			)
		).toBeTruthy()
		expect(
			screen.queryByRole('heading', { name: 'Empty repository' })
		).toBeNull()
		expect(
			screen.getByRole('heading', {
				name: 'Push an existing project to GitHub',
			})
		).toBeTruthy()
		expect(screen.getByText(`git clone ${GITHUB_CLONE_URLS.ssh}`)).toBeTruthy()
		expect(
			screen.queryByText(
				'Clone it locally or push an existing project to publish the first commit.'
			)
		).toBeNull()
	})

	test('keeps historical GitHub provenance after cutover, with no controls', () => {
		render(<RepositoryOverview summary={asOwner(getTesseraSourceSummary())} />)

		expect(screen.getByText('Tessera is the source of truth')).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_REPOSITORY_REGEX })
		).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: MIRROR_BUTTON_REGEX })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_REGEX })
		).toBeNull()
	})

	test('links the owner to GitHub settings, and never an admin', () => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'healthy' })

		const { rerender } = render(
			<RepositoryOverview summary={asOwner(getMirroredSummary())} />
		)

		expect(
			screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')
		).toBe('/mnigos/tessera-notes/settings/github')

		rerender(
			<RepositoryOverview
				summary={{ ...getMirroredSummary(), viewerRole: 'admin' }}
			/>
		)

		expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull()
	})

	test('does not show a source strip for native Tessera repositories', () => {
		render(<RepositoryOverview summary={asOwner(getSummary())} />)

		expect(screen.queryByText('GitHub is the source of truth')).toBeNull()
		expect(screen.queryByText('Imported from GitHub')).toBeNull()
		expect(screen.queryByText('Tessera is the source of truth')).toBeNull()
		expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull()
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
