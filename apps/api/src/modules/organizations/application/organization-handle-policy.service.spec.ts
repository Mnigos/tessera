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
import { OrganizationHandlePolicyRepository } from '../infrastructure/organization-handle-policy.repository'
import { LocalHandleAvailabilityService } from './local-handle-availability.service'
import { OrganizationHandlePolicyService } from './organization-handle-policy.service'

const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId

describe(OrganizationHandlePolicyService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationHandlePolicyService
	let localAvailability: LocalHandleAvailabilityService
	let client: GitHubLoginClient
	let cache: GitHubLoginCacheRepository
	let repository: OrganizationHandlePolicyRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationHandlePolicyService,
				{
					provide: LocalHandleAvailabilityService,
					useValue: { isTaken: vi.fn().mockResolvedValue(false) },
				},
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
						withDedupe: vi.fn((_slug, resolve) => resolve()),
					},
				},
				{
					provide: OrganizationHandlePolicyRepository,
					useValue: { findGitHubAccount: vi.fn().mockResolvedValue(undefined) },
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationHandlePolicyService)
		localAvailability = moduleRef.get(LocalHandleAvailabilityService)
		client = moduleRef.get(GitHubLoginClient)
		cache = moduleRef.get(GitHubLoginCacheRepository)
		repository = moduleRef.get(OrganizationHandlePolicyRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('rejects a local handle before consulting GitHub', async () => {
		vi.spyOn(localAvailability, 'isTaken').mockResolvedValue(true)

		await expect(
			service.assertAvailable({ slug: ' Tessera ', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugTakenError)
		expect(localAvailability.isTaken).toHaveBeenCalledWith('tessera', undefined)
		expect(cache.get).not.toHaveBeenCalled()
		expect(client.lookupLogin).not.toHaveBeenCalled()
	})

	test('passes ignoreOrganizationId through on rename', async () => {
		await service.assertAvailable({
			slug: 'tessera-next',
			actorUserId,
			ignoreOrganizationId: organizationId,
		})

		expect(localAvailability.isTaken).toHaveBeenCalledWith(
			'tessera-next',
			organizationId
		)
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
			type: 'Organization',
		})

		expect(
			await service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).toBeUndefined()
		expect(cache.set).toHaveBeenCalledWith(
			'tesserahq',
			{ exists: true, id: 42, login: 'TesseraHQ', type: 'Organization' },
			GITHUB_LOGIN_EXISTS_TTL_SECONDS
		)
	})

	test('rejects an existing unclaimed GitHub login by the requested handle', async () => {
		vi.spyOn(client, 'lookupLogin').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'CanonicalLogin',
			type: 'User',
		})

		const promise = service.assertAvailable({ slug: 'old-login', actorUserId })

		await expect(promise).rejects.toBeInstanceOf(
			OrganizationSlugGitHubConflictError
		)
		// GitHub follows rename redirects, so the message names the handle the
		// user typed; the canonical login travels in the error context.
		await expect(promise).rejects.toMatchObject({
			message:
				'old-login is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.',
			context: { login: 'old-login', canonicalLogin: 'CanonicalLogin' },
		})
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
			type: 'Organization',
		})

		await expect(
			service.assertAvailable({ slug: 'tesserahq', actorUserId })
		).rejects.toBeInstanceOf(OrganizationSlugGitHubConflictError)

		expect(client.lookupLogin).not.toHaveBeenCalled()
	})

	test('revalidates a cached positive before authorizing a linked account', async () => {
		vi.spyOn(cache, 'get').mockResolvedValue({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
			type: 'Organization',
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
			type: 'Organization',
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
			type: 'Organization',
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
