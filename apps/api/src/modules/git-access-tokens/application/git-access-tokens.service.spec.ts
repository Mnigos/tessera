import { Test, type TestingModule } from '@nestjs/testing'
import type { Auth } from '@repo/auth'
import type { ApiKeyId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { mockUserId } from '~/shared/test-utils'
import {
	GitAccessTokenNotFoundError,
	GitAccessTokenPermissionDeniedError,
	InvalidGitAccessTokenError,
} from '../domain/git-access-token.errors'
import { GitAccessTokensRepository } from '../infrastructure/git-access-tokens.repository'
import { GitAccessTokensService } from './git-access-tokens.service'

const createdAt = new Date('2026-05-12T00:00:00Z')
const apiKey = {
	id: '00000000-0000-4000-8000-000000000010' as ApiKeyId,
	configId: 'git-access-tokens',
	name: 'Laptop',
	start: 'tes_git_abc',
	prefix: 'tes_git_',
	key: 'hashed',
	referenceId: mockUserId,
	refillInterval: null,
	refillAmount: null,
	lastRefillAt: null,
	enabled: true,
	rateLimitEnabled: true,
	rateLimitTimeWindow: null,
	rateLimitMax: null,
	requestCount: 0,
	remaining: null,
	lastRequest: null,
	expiresAt: null,
	createdAt,
	updatedAt: createdAt,
	permissions: JSON.stringify({ git: ['read', 'write'] }),
	metadata: null,
}

describe(GitAccessTokensService.name, () => {
	let moduleRef: TestingModule
	let gitAccessTokensService: GitAccessTokensService
	let gitAccessTokensRepository: GitAccessTokensRepository
	let betterAuthService: BetterAuthService<Auth>

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitAccessTokensService,
				{
					provide: BetterAuthService,
					useValue: {
						api: {
							createApiKey: vi.fn(),
							updateApiKey: vi.fn(),
							verifyApiKey: vi.fn(),
						},
					},
				},
				{
					provide: GitAccessTokensRepository,
					useValue: {
						list: vi.fn(),
						findOwned: vi.fn(),
					},
				},
			],
		}).compile()

		gitAccessTokensService = moduleRef.get(GitAccessTokensService)
		gitAccessTokensRepository = moduleRef.get(GitAccessTokensRepository)
		betterAuthService = moduleRef.get(BetterAuthService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a Better Auth API key for git access and returns the raw secret once', async () => {
		const createApiKeySpy = vi
			.spyOn(betterAuthService.api, 'createApiKey')
			.mockResolvedValue({
				...apiKey,
				key: 'tes_git_raw-secret',
				permissions: { git: ['read', 'write'] },
			})

		expect(
			await gitAccessTokensService.create(mockUserId, {
				name: 'Laptop',
				permissions: ['git:write'],
			})
		).toEqual({
			token: 'tes_git_raw-secret',
			accessToken: expect.objectContaining({
				id: apiKey.id,
				name: 'Laptop',
				permissions: { git: ['read', 'write'] },
			}),
		})
		expect(createApiKeySpy).toHaveBeenCalledWith({
			body: {
				configId: 'git-access-tokens',
				userId: mockUserId,
				name: 'Laptop',
				expiresIn: undefined,
				prefix: 'tes_git_',
				permissions: { git: ['read', 'write'] },
			},
		})
	})

	test('lists owned token metadata without raw secrets', async () => {
		vi.spyOn(gitAccessTokensRepository, 'list').mockResolvedValue([apiKey])

		expect(await gitAccessTokensService.list(mockUserId)).toEqual([
			expect.objectContaining({
				id: apiKey.id,
				start: 'tes_git_abc',
				permissions: { git: ['read', 'write'] },
			}),
		])
	})

	test('creates read-only git access tokens', async () => {
		const createApiKeySpy = vi
			.spyOn(betterAuthService.api, 'createApiKey')
			.mockResolvedValue({
				...apiKey,
				key: 'tes_git_raw-secret',
				permissions: { git: ['read'] },
			})

		await gitAccessTokensService.create(mockUserId, {
			name: 'Read only',
			permissions: ['git:read'],
		})

		expect(createApiKeySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({
					permissions: { git: ['read'] },
				}),
			})
		)
	})

	test('parses created token permissions returned as JSON', async () => {
		vi.spyOn(betterAuthService.api, 'createApiKey').mockResolvedValue({
			...apiKey,
			key: 'tes_git_raw-secret',
			permissions: JSON.stringify({ git: ['read'] }),
		})

		expect(
			await gitAccessTokensService.create(mockUserId, {
				name: 'Read only',
				permissions: ['git:read'],
			})
		).toEqual(
			expect.objectContaining({
				accessToken: expect.objectContaining({
					permissions: { git: ['read'] },
				}),
			})
		)
	})

	test('revokes an owned token through Better Auth', async () => {
		const findOwnedSpy = vi
			.spyOn(gitAccessTokensRepository, 'findOwned')
			.mockResolvedValue(apiKey)
		const updateApiKeySpy = vi.spyOn(betterAuthService.api, 'updateApiKey')

		await gitAccessTokensService.revoke(mockUserId, apiKey.id)

		expect(findOwnedSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			tokenId: apiKey.id,
		})
		expect(updateApiKeySpy).toHaveBeenCalledWith({
			body: {
				configId: 'git-access-tokens',
				keyId: apiKey.id,
				userId: mockUserId,
				enabled: false,
			},
		})
	})

	test('rejects revoke for tokens not owned by the user', async () => {
		vi.spyOn(gitAccessTokensRepository, 'findOwned').mockResolvedValue(
			undefined
		)
		const updateApiKeySpy = vi.spyOn(betterAuthService.api, 'updateApiKey')

		await expect(
			gitAccessTokensService.revoke(mockUserId, apiKey.id)
		).rejects.toBeInstanceOf(GitAccessTokenNotFoundError)
		expect(updateApiKeySpy).not.toHaveBeenCalled()
	})

	test('verifies a raw token with the required permission', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: {
				...apiKey,
				permissions: { git: ['read', 'write'] },
			},
		})

		expect(
			await gitAccessTokensService.verify({
				rawToken: 'tes_git_raw-secret',
				requiredPermission: 'git:write',
			})
		).toEqual({
			userId: mockUserId,
			permissions: { git: ['read', 'write'] },
		})
	})

	test('verifies a raw token with permissions returned as JSON', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: apiKey as never,
		})

		expect(
			await gitAccessTokensService.verify({
				rawToken: 'tes_git_raw-secret',
				requiredPermission: 'git:write',
			})
		).toEqual({
			userId: mockUserId,
			permissions: { git: ['read', 'write'] },
		})
	})

	test('rejects invalid tokens', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: false,
			error: { code: 'KEY_NOT_FOUND', message: 'Invalid API key' },
			key: null,
		})

		await expect(
			gitAccessTokensService.verify({
				rawToken: 'tes_git_missing',
				requiredPermission: 'git:read',
			})
		).rejects.toBeInstanceOf(InvalidGitAccessTokenError)
	})

	test('rejects missing raw tokens before calling Better Auth', async () => {
		const verifyApiKeySpy = vi.spyOn(betterAuthService.api, 'verifyApiKey')

		await expect(
			gitAccessTokensService.verify({
				rawToken: undefined,
				requiredPermission: 'git:read',
			})
		).rejects.toBeInstanceOf(InvalidGitAccessTokenError)
		expect(verifyApiKeySpy).not.toHaveBeenCalled()
	})

	test('rejects revoked tokens returned by Better Auth as disabled', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: false,
			error: { code: 'KEY_DISABLED', message: 'API key disabled' },
			key: null,
		})

		await expect(
			gitAccessTokensService.verify({
				rawToken: 'tes_git_disabled',
				requiredPermission: 'git:read',
			})
		).rejects.toBeInstanceOf(InvalidGitAccessTokenError)
	})

	test('rejects expired tokens returned by Better Auth as expired', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: false,
			error: { code: 'KEY_EXPIRED', message: 'API key expired' },
			key: null,
		})

		await expect(
			gitAccessTokensService.verify({
				rawToken: 'tes_git_expired',
				requiredPermission: 'git:read',
			})
		).rejects.toBeInstanceOf(InvalidGitAccessTokenError)
	})

	test('rejects tokens missing the required permission', async () => {
		vi.spyOn(betterAuthService.api, 'verifyApiKey').mockResolvedValue({
			valid: true,
			error: null,
			key: {
				...apiKey,
				permissions: { git: ['read'] },
			},
		})

		await expect(
			gitAccessTokensService.verify({
				rawToken: 'tes_git_read-only',
				requiredPermission: 'git:write',
			})
		).rejects.toBeInstanceOf(GitAccessTokenPermissionDeniedError)
	})
})
