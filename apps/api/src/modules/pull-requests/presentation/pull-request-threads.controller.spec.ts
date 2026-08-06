import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { PullRequestThreadsService } from '../application/pull-request-threads.service'
import { PullRequestThreadsController } from './pull-request-threads.controller'

const session = createMockSession()
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}
const threadId = '00000000-0000-4000-8000-000000000051' as const
const commentId = '00000000-0000-4000-8000-000000000052' as const

describe(PullRequestThreadsController.name, () => {
	let moduleRef: TestingModule
	let controller: PullRequestThreadsController
	let service: PullRequestThreadsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [PullRequestThreadsController],
			providers: [
				{
					provide: PullRequestThreadsService,
					useValue: {
						list: vi.fn(),
						createThread: vi.fn(),
						replyThread: vi.fn(),
						editComment: vi.fn(),
						deleteComment: vi.fn(),
						resolveThread: vi.fn(),
						unresolveThread: vi.fn(),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(PullRequestThreadsController)
		service = moduleRef.get(PullRequestThreadsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates listThreads with optional session and input', async () => {
		const listSpy = vi.spyOn(service, 'list').mockResolvedValue({} as never)
		const procedure = controller.listThreads()

		expect(
			await procedure['~orpc'].handler({
				input: repositoryInput,
				context: {},
				path: ['pullRequests', 'listThreads'],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({})
		expect(listSpy).toHaveBeenCalledWith(undefined, repositoryInput)
	})

	test.each([
		{
			action: 'createThread' as const,
			serviceAction: 'createThread' as const,
			input: { ...repositoryInput, body: 'Comment' },
		},
		{
			action: 'replyThread' as const,
			serviceAction: 'replyThread' as const,
			input: { ...repositoryInput, threadId, body: 'Reply' },
		},
		{
			action: 'editComment' as const,
			serviceAction: 'editComment' as const,
			input: { ...repositoryInput, commentId, body: 'Edited' },
		},
		{
			action: 'deleteComment' as const,
			serviceAction: 'deleteComment' as const,
			input: { ...repositoryInput, commentId },
		},
		{
			action: 'resolveThread' as const,
			serviceAction: 'resolveThread' as const,
			input: { ...repositoryInput, threadId },
		},
		{
			action: 'unresolveThread' as const,
			serviceAction: 'unresolveThread' as const,
			input: { ...repositoryInput, threadId },
		},
	])('delegates $action with session and input', async ({
		action,
		input,
		serviceAction,
	}) => {
		const actionSpy = vi
			.spyOn(service, serviceAction)
			.mockResolvedValue({} as never)
		const procedure = controller[action](session)

		expect(
			await procedure['~orpc'].handler({
				input: input as never,
				context: {},
				path: ['pullRequests', action],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({})
		expect(actionSpy).toHaveBeenCalledWith(mockUserId, input)
	})
})
