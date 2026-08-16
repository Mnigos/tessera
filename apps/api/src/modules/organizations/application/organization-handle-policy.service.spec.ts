import { Test, type TestingModule } from '@nestjs/testing'
import type { OrganizationId, UserId } from '@repo/domain'
import {
	GitHubLookupUnavailableError,
	OrganizationSlugGitHubConflictError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'
import { GitHubLoginClient } from '../infrastructure/github-login.client'
import {
	GITHUB_LOGIN_EXISTS_TTL_SECONDS,
	GITHUB_LOGIN_MISSING_TTL_SECONDS,
	GitHubLoginCacheRepository,
} from '../infrastructure/github-login-cache.repository'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationHandlePolicyService } from './organization-handle-policy.service'

const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId

describe(OrganizationHandlePolicyService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationHandlePolicyService
	let client: GitHubLoginClient
	let cache: GitHubLoginCacheRepository
	let repository: OrganizationsRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationHandlePolicyService,
				{
					provide: GitHubLoginClient,
					useValue: {
						lookupLogin: vi.fn().mockResolvedValue({ exists: false }),
					},
				},
				{
					provide: GitHubLoginCacheRepository,
					useValue: {
						get: vi.fn().mockResolvedValue(undefined),
						set: vi.fn(),
					},
				},
				{
					provide: OrganizationsRepository,
					useValue: {
						isHandleTaken: vi.fn().mockResolvedValue(false),
						findGitHubAccount: vi.fn().mockResolvedValue(undefined),
					},
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationHandlePolicyService)
		client = moduleRef.get(GitHubLoginClient)
		cache = moduleRef.get(GitHubLoginCacheRepository)
		repository = moduleRef.get(OrganizationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('rejects a local handle before consulting GitHub', async () => {
		vi.spyOn(repository, 'isHandleTaken').mockResolvedValue(true)

		await expect(
			service.assertAvailable({ slug: ' Tessera ', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugTakenError)
		expect(repository.isHandleTaken).toHaveBeenCalledWith({
			handle: 'tessera',
			ignoreOrganizationId: undefined,
		})
		expect(cache.get).not.toHaveBeenCalled()
		expect(client.lookupLogin).not.toHaveBeenCalled()
	})

	test('passes ignoreOrganizationId through on rename', async () => {
		await service.assertAvailable({
			slug: 'tessera-next',
			actorUserId,
			ignoreOrganizationId: organizationId,
		})

		expect(repository.isHandleTaken).toHaveBeenCalledWith({
			handle: 'tessera-next',
			ignoreOrganizationId: organizationId,
		})
	})

	test('allows a GitHub 404 and caches it for the negative TTL', async () => {
		expect(
			await service.assertAvailable({ slug: 'available', actorUserId })
		).toBeUndefined()
		expect(client.lookupLogin).toHaveBeenCalledWith('available', {
			accessToken: null,
		})
		expect(cache.set).toHaveBeenCalledWith(
			'available',
			{ exists: false },
			GITHUB_LOGIN_MISSING_TTL_SECONDS
		)
	})

	test('allows an existing login claimed by the linked account regardless of login casing', async () => {
		vi.spyOn(repository, 'findGitHubAccount').mockResolvedValue({
			accountId: '42',
			accessToken: 'github-token',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(client, 'lookupLogin').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})

		expect(
			await service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).toBeUndefined()
		expect(cache.set).toHaveBeenCalledWith(
			'tesserahq',
			{ exists: true, id: 42, login: 'TesseraHQ' },
			GITHUB_LOGIN_EXISTS_TTL_SECONDS
		)
	})

	test('rejects an existing unclaimed GitHub login by the requested handle', async () => {
		vi.spyOn(client, 'lookupLogin').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'CanonicalLogin',
		})

		await expect(
			service.assertAvailable({ slug: 'old-login', actorUserId })
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof OrganizationSlugGitHubConflictError &&
				error.message ===
					'old-login is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.' &&
				error.context?.login === 'old-login' &&
				error.context?.canonicalLogin === 'CanonicalLogin'
		)
	})

	test('uses a cached negative result without calling the client or actor lookup', async () => {
		vi.spyOn(cache, 'get').mockResolvedValue({ exists: false })

		await service.assertAvailable({ slug: 'available', actorUserId })

		expect(client.lookupLogin).not.toHaveBeenCalled()
		expect(repository.findGitHubAccount).not.toHaveBeenCalled()
	})

	test('uses a cached positive without calling the client for an unlinked actor', async () => {
		vi.spyOn(cache, 'get').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})

		await expect(
			service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugGitHubConflictError)

		expect(client.lookupLogin).not.toHaveBeenCalled()
		expect(cache.set).not.toHaveBeenCalled()
	})

	test('revalidates a cached positive before authorizing a linked account', async () => {
		vi.spyOn(cache, 'get').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})
		vi.spyOn(repository, 'findGitHubAccount').mockResolvedValue({
			accountId: '42',
			accessToken: null,
			accessTokenExpiresAt: null,
		})
		vi.spyOn(client, 'lookupLogin').mockResolvedValue({
			exists: true,
			id: 43,
			login: 'TesseraHQ',
		})

		await expect(
			service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugGitHubConflictError)
		expect(client.lookupLogin).toHaveBeenCalledWith('tesserahq', {
			accessToken: null,
		})
	})

	test.each([
		'',
		'not-a-number',
		'0',
		'-1',
		String(Number.MAX_SAFE_INTEGER + 1),
	])('does not authorize an invalid linked account id %j', async accountId => {
		vi.spyOn(repository, 'findGitHubAccount').mockResolvedValue({
			accountId,
			accessToken: null,
			accessTokenExpiresAt: null,
		})
		vi.spyOn(client, 'lookupLogin').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})

		await expect(
			service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugGitHubConflictError)
	})

	test.each([
		['unauthorized', 401],
		['forbidden', 403],
		['rate limited', 429],
		['server error', 500],
		['timeout', undefined],
	] as const)('does not cache a %s GitHub lookup failure', async (_label, status) => {
		vi.spyOn(client, 'lookupLogin').mockRejectedValue(
			new GitHubLookupUnavailableError(status ? { status } : { timeout: true })
		)

		await expect(
			service.assertAvailable({ slug: 'unavailable', actorUserId })
		).rejects.toBeInstanceOf(GitHubLookupUnavailableError)
		expect(cache.set).not.toHaveBeenCalled()
	})

	test('drops an expired actor token', async () => {
		vi.spyOn(repository, 'findGitHubAccount').mockResolvedValue({
			accountId: '42',
			accessToken: 'expired-token',
			accessTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
		})

		await service.assertAvailable({ slug: 'available', actorUserId })

		expect(client.lookupLogin).toHaveBeenCalledWith('available', {
			accessToken: null,
		})
	})
})
