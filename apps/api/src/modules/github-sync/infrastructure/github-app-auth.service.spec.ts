import { EnvService } from '@config/env'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createAppAuth } from '@octokit/auth-app'
import { isSecretFree } from '~/shared/test-utils'
import { GitHubAppConfigurationError } from '../domain/github-sync.errors'
import { GitHubAppAuthService } from './github-app-auth.service'

vi.mock('@octokit/auth-app', () => ({ createAppAuth: vi.fn() }))

describe('GitHubAppAuthService', () => {
	let service: GitHubAppAuthService
	let envService: { get: ReturnType<typeof vi.fn> }

	beforeEach(async () => {
		envService = {
			get: vi.fn((key: string) => {
				if (key === 'GITHUB_APP_ID') return 42
				if (key === 'GITHUB_APP_PRIVATE_KEY') return 'private\\nkey'
			}),
		}
		const module = await Test.createTestingModule({
			providers: [
				GitHubAppAuthService,
				{ provide: EnvService, useValue: envService },
			],
		}).compile()

		service = module.get(GitHubAppAuthService)
	})

	test('mints and reuses a fresh installation token', async () => {
		const auth = Object.assign(
			vi.fn().mockResolvedValue({
				token: 'installation-token',
				expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
			}),
			{ hook: vi.fn() }
		)
		vi.mocked(createAppAuth).mockReturnValue(auth)

		expect(await service.getInstallationToken(123n)).toMatchObject({
			token: 'installation-token',
		})
		expect(await service.getInstallationToken(123n)).toMatchObject({
			token: 'installation-token',
		})
		expect(auth).toHaveBeenCalledTimes(1)
		expect(createAppAuth).toHaveBeenCalledWith({
			appId: 42,
			privateKey: 'private\nkey',
		})
	})

	test('rejects missing GitHub App configuration', async () => {
		envService.get.mockReturnValue(undefined)

		await expect(service.getInstallationToken(123n)).rejects.toBeInstanceOf(
			GitHubAppConfigurationError
		)
	})

	test('classifies an unreachable GitHub as retryable without logging its stack', async () => {
		const auth = Object.assign(
			vi.fn().mockRejectedValue(new Error('GitHub unavailable at ghs_secret')),
			{ hook: vi.fn() }
		)
		vi.mocked(createAppAuth).mockReturnValue(auth)
		const loggerErrorSpy = vi
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined)

		const promise = service.getInstallationToken(123n)

		await expect(promise).rejects.toMatchObject({
			context: expect.objectContaining({
				externalInstallationId: '123',
				failureClass: 'transport',
				failureCode: 'upstream_unavailable',
			}),
		})
		await expect(promise).rejects.toSatisfy((error: Error) =>
			isSecretFree(error, ['ghs_secret'])
		)
		// The stack of a rejected authentication carries whatever the provider
		// library put in it, so only the classification is logged.
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'GitHub App authentication for installation 123 failed as transport/upstream_unavailable'
		)
	})

	test('classifies a rejected credential as lost access', async () => {
		const auth = Object.assign(
			vi
				.fn()
				.mockRejectedValue(Object.assign(new Error('bad'), { status: 401 })),
			{ hook: vi.fn() }
		)
		vi.mocked(createAppAuth).mockReturnValue(auth)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await expect(service.getInstallationToken(123n)).rejects.toMatchObject({
			context: expect.objectContaining({ failureClass: 'authentication' }),
		})
	})

	test('stops presenting a cached token once it is evicted', async () => {
		const auth = Object.assign(
			vi.fn().mockResolvedValue({
				token: 'installation-token',
				expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
			}),
			{ hook: vi.fn() }
		)
		vi.mocked(createAppAuth).mockReturnValue(auth)

		await service.getInstallationToken(123n)
		await service.getInstallationToken(123n)

		expect(auth).toHaveBeenCalledOnce()

		service.evictInstallationToken(123n)
		await service.getInstallationToken(123n)

		expect(auth).toHaveBeenCalledTimes(2)
	})
})
