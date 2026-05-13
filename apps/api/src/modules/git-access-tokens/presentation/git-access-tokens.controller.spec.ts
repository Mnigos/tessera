import { Test, type TestingModule } from '@nestjs/testing'
import type { GitAccessToken } from '@repo/contracts'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { GitAccessTokensService } from '../application/git-access-tokens.service'
import { GitAccessTokensController } from './git-access-tokens.controller'

const session = createMockSession()
const accessToken: GitAccessToken = {
	id: '00000000-0000-4000-8000-000000000010' as GitAccessToken['id'],
	name: 'Laptop',
	prefix: 'tes_git_',
	start: 'tes_git_abc',
	enabled: true,
	permissions: { git: ['read', 'write'] },
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

describe(GitAccessTokensController.name, () => {
	let moduleRef: TestingModule
	let gitAccessTokensController: GitAccessTokensController
	let gitAccessTokensService: GitAccessTokensService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [GitAccessTokensController],
			providers: [
				{
					provide: GitAccessTokensService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						revoke: vi.fn(),
					},
				},
			],
		}).compile()

		gitAccessTokensController = moduleRef.get(GitAccessTokensController)
		gitAccessTokensService = moduleRef.get(GitAccessTokensService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests to the service', async () => {
		const createSpy = vi
			.spyOn(gitAccessTokensService, 'create')
			.mockResolvedValue({ token: 'tes_git_raw-secret', accessToken })

		expect(
			await gitAccessTokensController.create(session)['~orpc'].handler({
				input: { name: 'Laptop', permissions: ['git:write'] },
				context: {},
				path: ['gitAccessTokens', 'create'],
				procedure: gitAccessTokensController.create(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ token: 'tes_git_raw-secret', accessToken })
		expect(createSpy).toHaveBeenCalledWith(mockUserId, {
			name: 'Laptop',
			permissions: ['git:write'],
		})
	})

	test('delegates list requests to the service', async () => {
		const listSpy = vi
			.spyOn(gitAccessTokensService, 'list')
			.mockResolvedValue([accessToken])

		expect(
			await gitAccessTokensController.list(session)['~orpc'].handler({
				input: undefined,
				context: {},
				path: ['gitAccessTokens', 'list'],
				procedure: gitAccessTokensController.list(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ accessTokens: [accessToken] })
		expect(listSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates revoke requests to the service', async () => {
		const revokeSpy = vi.spyOn(gitAccessTokensService, 'revoke')

		expect(
			await gitAccessTokensController.revoke(session)['~orpc'].handler({
				input: { id: accessToken.id },
				context: {},
				path: ['gitAccessTokens', 'revoke'],
				procedure: gitAccessTokensController.revoke(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ success: true })
		expect(revokeSpy).toHaveBeenCalledWith(mockUserId, accessToken.id)
	})
})
