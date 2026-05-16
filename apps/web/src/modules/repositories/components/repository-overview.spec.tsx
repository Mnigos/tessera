import type { RepositoryBrowserSummary } from '@repo/contracts'
import { toast } from '@repo/ui/components/sonner'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { getRepositoryCloneUrl } from '../helpers/get-repository-clone-url'
import {
	getFallbackRefOptions,
	getSelectedRepositoryQualifiedRef,
} from '../helpers/repository-refs'
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
	getRepositoryCloneUrl: vi.fn(),
}))

const getRepositoryCloneUrlMock = vi.mocked(getRepositoryCloneUrl)

const baseSummary = {
	repository: {
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08' as RepositoryBrowserSummary['repository']['id'],
		slug: 'tessera-notes' as RepositoryBrowserSummary['repository']['slug'],
		name: 'Tessera Notes',
		visibility: 'public',
		description: 'Repository overview fixtures',
		defaultBranch: 'main',
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

const readmeHeadingRegex = /readme/i
const readmeTruncatedRegex = /README preview is truncated/i

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

describe('RepositoryOverview', () => {
	afterEach(() => {
		vi.restoreAllMocks()
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
			screen.queryByRole('heading', { name: readmeHeadingRegex })
		).toBeNull()
		expect(screen.queryByText(readmeTruncatedRegex)).toBeNull()
		expect(screen.getByRole('heading', { name: 'Files' })).toBeTruthy()
		expect(screen.getByText('src')).toBeTruthy()
		expect(screen.getByText('package.json')).toBeTruthy()
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
	})

	test('shows clone and push commands for an empty repository', async () => {
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue(undefined)
		getRepositoryCloneUrlMock.mockReturnValue(expectedCloneUrl)
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
		expect(screen.getByText(`git clone ${expectedCloneUrl}`)).toBeTruthy()
		expect(
			screen.getByText(`git remote add origin ${expectedCloneUrl}`)
		).toBeTruthy()
		expect(screen.getByText('git push origin main')).toBeTruthy()
		expect(
			screen
				.getByRole('combobox', { name: 'Repository ref' })
				.hasAttribute('disabled')
		).toBe(true)

		await user.click(
			screen.getByRole('button', { name: 'Copy repository clone URL' })
		)

		expect(writeTextSpy).toHaveBeenCalledWith(expectedCloneUrl)
		expect(
			screen.getByRole('button', { name: 'Clone URL copied' })
		).toBeTruthy()
		expect(screen.getByText('Clone URL copied')).toBeTruthy()
	})

	test('shows copy failure feedback for empty repositories', async () => {
		const error = new Error('clipboard unavailable')
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined)
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(error)
		getRepositoryCloneUrlMock.mockReturnValue(expectedCloneUrl)
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

		await user.click(
			screen.getByRole('button', { name: 'Copy repository clone URL' })
		)

		expect(consoleErrorSpy).toHaveBeenCalledWith(error)
		expect(toast.error).toHaveBeenCalledWith('Could not copy clone URL')
	})
})
