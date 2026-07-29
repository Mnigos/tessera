import { EnvService } from '@config/env'
import { Test } from '@nestjs/testing'
import { createAppAuth } from '@octokit/auth-app'
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
})
