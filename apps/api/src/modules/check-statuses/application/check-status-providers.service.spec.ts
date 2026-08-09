import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Auth } from '@repo/auth'
import type {
	ApiKeyId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { mockUserId } from '~/shared/test-utils'
import {
	CheckStatusCredentialNotFoundError,
	CheckStatusPermissionDeniedError,
	CheckStatusProviderAlreadyExistsError,
	CheckStatusProviderNotFoundError,
	InvalidCheckStatusCredentialError,
} from '../domain/check-status-credential.errors'
import { CheckStatusProvidersRepository } from '../infrastructure/check-status-providers.repository'
import { CheckStatusProvidersService } from './check-status-providers.service'

const createdAt = new Date('2026-08-08T10:00:00Z')
const apiKeyId = '00000000-0000-4000-8000-000000000010' as ApiKeyId
const repositoryId = '00000000-0000-4000-8000-000000000011' as RepositoryId
const providerId =
	'00000000-0000-4000-8000-000000000012' as CheckStatusProviderId
const credentialId =
	'00000000-0000-4000-8000-000000000013' as CheckStatusCredentialId
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
}
const provider = {
	id: providerId,
	key: 'jenkins',
	displayName: 'Jenkins',
	createdAt,
	updatedAt: createdAt,
}
const credential = {
	id: credentialId,
	providerId,
	apiKeyId,
	start: null,
	enabled: true,
	revokedAt: null,
	expiresAt: null,
	lastUsedAt: null,
	createdAt,
}

describe(CheckStatusProvidersService.name, () => {
	let moduleRef: TestingModule
	let service: CheckStatusProvidersService
	let providersRepository: CheckStatusProvidersRepository
	let betterAuthService: BetterAuthService<Auth>

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				CheckStatusProvidersService,
				{
					provide: BetterAuthService,
					useValue: {
						api: {
							updateApiKey: vi.fn(),
							createApiKey: vi.fn().mockResolvedValue({
								id: apiKeyId,
								key: 'tes_status_raw-secret',
								start: 'tes_status_abc',
								expiresAt: null,
							}),
							verifyApiKey: vi.fn(),
						},
					},
				},
				{
					provide: CheckStatusProvidersRepository,
					useValue: {
						listProviders: vi.fn().mockResolvedValue([provider]),
						listCredentials: vi.fn().mockResolvedValue([credential]),
						findProvider: vi.fn().mockResolvedValue(provider),
						createProviderWithCredential: vi
							.fn()
							.mockResolvedValue({ provider, credential }),
						createCredential: vi.fn().mockResolvedValue(credential),
						revokeCredential: vi.fn().mockResolvedValue({
							status: 'revoked',
							apiKeyId,
							createdByUserId: mockUserId,
						}),
					},
				},
				{
					provide: RepositoriesService,
					useValue: {
						getManageableRepositoryContext: vi
							.fn()
							.mockResolvedValue({ repositoryId }),
					},
				},
			],
		}).compile()

		service = moduleRef.get(CheckStatusProvidersService)
		providersRepository = moduleRef.get(CheckStatusProvidersRepository)
		betterAuthService = moduleRef.get(BetterAuthService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('registers a provider and hands back its secret exactly once', async () => {
		const created = await service.createProvider(mockUserId, {
			...repositoryInput,
			key: 'jenkins',
			displayName: 'Jenkins',
		})

		expect(betterAuthService.api.createApiKey).toHaveBeenCalledWith({
			body: expect.objectContaining({
				configId: 'status-provider-credentials',
				prefix: 'tes_status_',
				permissions: { checks: ['write'] },
			}),
		})
		expect(created.token).toBe('tes_status_raw-secret')

		// The listing that follows is read back from storage, which holds a hash.
		const { providers } = await service.list(mockUserId, repositoryInput)

		expect(providers[0]?.credentials[0]).not.toHaveProperty('token')
		expect(JSON.stringify(providers)).not.toContain('raw-secret')
	})

	test('reports a duplicate key as a conflict rather than a failed insert', async () => {
		vi.spyOn(
			providersRepository,
			'createProviderWithCredential'
		).mockRejectedValue(
			Object.assign(new Error('duplicate key'), {
				cause: {
					code: '23505',
					constraint_name: 'check_status_providers_repository_key_unique',
				},
			})
		)

		await expect(
			service.createProvider(mockUserId, {
				...repositoryInput,
				key: 'jenkins',
				displayName: 'Jenkins',
			})
		).rejects.toBeInstanceOf(CheckStatusProviderAlreadyExistsError)
	})

	test('groups every provider with the credentials that belong to it', async () => {
		const { providers } = await service.list(mockUserId, repositoryInput)

		expect(providers).toHaveLength(1)
		expect(providers[0]?.key).toBe('jenkins')
		expect(providers[0]?.credentials).toHaveLength(1)
	})

	test('rotates by issuing a second credential against the same provider', async () => {
		const created = await service.createCredential(mockUserId, {
			...repositoryInput,
			providerId,
		})

		expect(created.provider.id).toBe(providerId)
		expect(providersRepository.createCredential).toHaveBeenCalledWith(
			expect.objectContaining({ provider, repositoryId })
		)
	})

	test('refuses to issue a credential for another repository’s provider', async () => {
		vi.spyOn(providersRepository, 'findProvider').mockResolvedValue(undefined)

		await expect(
			service.createCredential(mockUserId, { ...repositoryInput, providerId })
		).rejects.toBeInstanceOf(CheckStatusProviderNotFoundError)
	})

	test('revokes a credential, and says so again for one already revoked', async () => {
		expect(
			await service.revokeCredential(mockUserId, {
				...repositoryInput,
				credentialId,
			})
		).toEqual({ revoked: true })

		// A withdrawn secret stops authenticating, not merely stops being trusted.
		expect(betterAuthService.api.updateApiKey).toHaveBeenCalledWith({
			body: {
				configId: 'status-provider-credentials',
				keyId: apiKeyId,
				userId: mockUserId,
				enabled: false,
			},
		})

		vi.spyOn(providersRepository, 'revokeCredential').mockResolvedValue({
			status: 'already_revoked',
			apiKeyId,
			createdByUserId: mockUserId,
		})

		// The caller asked for a revoked credential and has one; repeating the
		// request is not a conflict to resolve.
		expect(
			await service.revokeCredential(mockUserId, {
				...repositoryInput,
				credentialId,
			})
		).toEqual({ revoked: true })
	})

	test('refuses to revoke a credential this repository does not own', async () => {
		vi.spyOn(providersRepository, 'revokeCredential').mockResolvedValue({
			status: 'not_found',
		})

		await expect(
			service.revokeCredential(mockUserId, { ...repositoryInput, credentialId })
		).rejects.toBeInstanceOf(CheckStatusCredentialNotFoundError)
	})

	test('verifies a credential against its own configuration and permission', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: { id: apiKeyId, permissions: { checks: ['write'] } },
		} as never)

		expect(await service.verifyCredential('tes_status_raw-secret')).toBe(
			apiKeyId
		)
		expect(betterAuthService.api.verifyApiKey).toHaveBeenCalledWith({
			body: {
				configId: 'status-provider-credentials',
				key: 'tes_status_raw-secret',
				permissions: { checks: ['write'] },
			},
		})
	})

	test('rejects a verified key that does not actually carry checks:write', async () => {
		// The lookup finds a key by its hash, not by configuration, so a key from
		// elsewhere that satisfied the request has still not been checked.
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: { id: apiKeyId, permissions: { git: ['read', 'write'] } },
		} as never)

		await expect(
			service.verifyCredential('tes_status_raw-secret')
		).rejects.toBeInstanceOf(CheckStatusPermissionDeniedError)

		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: { id: apiKeyId, permissions: null },
		} as never)

		await expect(
			service.verifyCredential('tes_status_raw-secret')
		).rejects.toBeInstanceOf(CheckStatusPermissionDeniedError)
	})

	test('rejects an absent token, a foreign prefix, and a key Better Auth refuses', async () => {
		await expect(service.verifyCredential(undefined)).rejects.toBeInstanceOf(
			InvalidCheckStatusCredentialError
		)

		// A Git token is a real key with real permissions; it simply is not one of
		// these, and it must not reach the verifier at all.
		await expect(
			service.verifyCredential('tes_git_raw-secret')
		).rejects.toBeInstanceOf(InvalidCheckStatusCredentialError)
		expect(betterAuthService.api.verifyApiKey).not.toHaveBeenCalled()

		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: false,
			error: { code: 'KEY_DISABLED', message: 'disabled' },
			key: null,
		} as never)

		await expect(
			service.verifyCredential('tes_status_raw-secret')
		).rejects.toBeInstanceOf(InvalidCheckStatusCredentialError)
	})
})
