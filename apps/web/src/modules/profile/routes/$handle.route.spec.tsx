import { ORPCError, safe } from '@orpc/client'
import type { HandleProfile } from '@repo/contracts'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { notFound } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { useHandleQuery } from '../hooks/use-handle.query'
import { Route } from './$handle.route'

vi.mock('@orpc/client', async importOriginal => ({
	...(await importOriginal<typeof import('@orpc/client')>()),
	safe: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
	createFileRoute: vi.fn(() => (options: Record<string, unknown>) => ({
		options,
		useParams: vi.fn(() => ({ handle: 'alice' })),
	})),
	notFound: vi.fn(() => new Error('route not found')),
}))
vi.mock('../hooks/use-handle.query', () => ({ useHandleQuery: vi.fn() }))
vi.mock('../components/profile-header', () => ({
	ProfileHeader: ({ profile }: { profile: { username: string } }) => (
		<div>User header {profile.username}</div>
	),
	ProfileHeaderSkeleton: () => <div>Profile skeleton</div>,
}))
vi.mock('../components/organization-header', () => ({
	OrganizationHeader: ({
		organization,
		viewerRole,
	}: {
		organization: { slug: string }
		viewerRole?: string
	}) => (
		<div>
			Organization header {organization.slug}
			{viewerRole ? ` Settings ${viewerRole}` : ''}
		</div>
	),
}))
vi.mock('../components/profile-repositories-section', () => ({
	ProfileRepositoriesSection: ({
		handle,
		isOwner,
		repositories,
	}: {
		handle: string
		isOwner: boolean
		repositories: { slug: string }[]
	}) => (
		<div>
			Repositories {handle} {isOwner ? 'owner' : 'viewer'}{' '}
			{repositories.map(repositoryRow => repositoryRow.slug).join(',')}
		</div>
	),
}))
vi.mock('@/modules/repositories/components/create-repository-section', () => ({
	CreateRepositorySection: ({ username }: { username: string }) => (
		<div>Create repository {username}</div>
	),
}))
vi.mock('@/modules/organizations/components/organizations-section', () => ({
	OrganizationsSection: () => <div>Your organizations</div>,
}))
vi.mock(
	'@/modules/git-access-tokens/components/git-access-tokens-section',
	() => ({
		GitAccessTokensSection: () => <div>Git access tokens</div>,
	})
)
vi.mock('@/modules/ssh-public-keys/components/ssh-public-keys-section', () => ({
	SshPublicKeysSection: () => <div>SSH public keys</div>,
}))
vi.mock('@/modules/gpg-public-keys/components/gpg-public-keys-section', () => ({
	GpgPublicKeysSection: () => <div>GPG public keys</div>,
}))

const useHandleQueryMock = vi.mocked(useHandleQuery)
const userId = '00000000-0000-4000-8000-000000000001' as UserId
const repository = {
	id: '00000000-0000-4000-8000-000000000020' as RepositoryId,
	name: 'Notes' as RepositoryName,
	slug: 'notes' as RepositorySlug,
	visibility: 'public' as const,
}
const userProfile: HandleProfile = {
	owner: {
		kind: 'user',
		user: {
			id: userId,
			username: 'alice',
			displayName: 'Alice',
		},
		viewerRole: 'self',
	},
	repositories: [repository],
}
const organizationProfile: HandleProfile = {
	owner: {
		kind: 'organization',
		organization: {
			id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
			slug: 'acme',
			name: 'Acme',
			createdAt: new Date('2026-08-16T10:00:00.000Z'),
		},
		viewerRole: 'member',
	},
	repositories: [repository],
}

function renderHandleRoute() {
	const HandleRoute = Route.options.component
	if (!HandleRoute) throw new Error('Expected handle route component')

	return render(<HandleRoute />)
}

describe('handle route', () => {
	beforeEach(() => {
		vi.mocked(Route.useParams).mockReturnValue({ handle: 'alice' } as never)
	})

	test('shows all self-only sections on the viewer user profile', () => {
		useHandleQueryMock.mockReturnValue({
			data: userProfile,
			isLoading: false,
			isError: false,
		} as never)

		renderHandleRoute()

		expect(screen.getByText('User header alice')).toBeTruthy()
		expect(screen.getByText('Repositories alice owner notes')).toBeTruthy()
		expect(screen.getByText('Create repository alice')).toBeTruthy()
		expect(screen.getByText('Your organizations')).toBeTruthy()
		expect(screen.getByText('Git access tokens')).toBeTruthy()
		expect(screen.getByText('SSH public keys')).toBeTruthy()
		expect(screen.getByText('GPG public keys')).toBeTruthy()
	})

	test('hides self-only sections on another user profile', () => {
		useHandleQueryMock.mockReturnValue({
			data: {
				...userProfile,
				owner: { ...userProfile.owner, viewerRole: undefined },
			},
			isLoading: false,
			isError: false,
		} as never)

		renderHandleRoute()

		expect(screen.getByText('Repositories alice viewer notes')).toBeTruthy()
		expect(screen.queryByText('Create repository alice')).toBeNull()
		expect(screen.queryByText('Your organizations')).toBeNull()
		expect(screen.queryByText('Git access tokens')).toBeNull()
		expect(screen.queryByText('SSH public keys')).toBeNull()
		expect(screen.queryByText('GPG public keys')).toBeNull()
	})

	test('shows the organization header and settings for a member', () => {
		vi.mocked(Route.useParams).mockReturnValue({ handle: 'acme' } as never)
		useHandleQueryMock.mockReturnValue({
			data: organizationProfile,
			isLoading: false,
			isError: false,
		} as never)

		renderHandleRoute()

		expect(
			screen.getByText('Organization header acme Settings member')
		).toBeTruthy()
		expect(screen.getByText('Repositories acme viewer notes')).toBeTruthy()
		expect(screen.queryByText('Create repository acme')).toBeNull()
	})

	test('renders the failed profile state when handle loading fails', () => {
		useHandleQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)

		renderHandleRoute()

		expect(screen.getByText('Profile could not be loaded.')).toBeTruthy()
	})

	test('turns an API 404 into the route not-found path', async () => {
		vi.mocked(safe).mockResolvedValue([
			new ORPCError('NOT_FOUND', { status: 404 }),
			undefined,
		] as never)
		const loader = Route.options.loader
		if (typeof loader !== 'function')
			throw new Error('Expected handle route loader')

		await expect(
			loader({
				context: {
					queryClient: { ensureQueryData: vi.fn() },
					orpc: {
						handles: {
							get: { queryOptions: vi.fn(options => options) },
						},
					},
				},
				params: { handle: 'missing' },
			} as never)
		).rejects.toThrow('route not found')
		expect(notFound).toHaveBeenCalledTimes(1)
	})
})
