import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { PullRequestReviewsService } from '../application/pull-request-reviews.service'
import { PullRequestReviewsController } from './pull-request-reviews.controller'

const session = createMockSession()
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}

describe(PullRequestReviewsController.name, () => {
	let moduleRef: TestingModule
	let controller: PullRequestReviewsController
	let service: PullRequestReviewsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [PullRequestReviewsController],
			providers: [
				{
					provide: PullRequestReviewsService,
					useValue: {
						requestReviewer: vi.fn(),
						removeReviewerRequest: vi.fn(),
						submitReview: vi.fn(),
						discardPendingReview: vi.fn(),
					},
				},
			],
		}).compile()
		controller = moduleRef.get(PullRequestReviewsController)
		service = moduleRef.get(PullRequestReviewsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test.each([
		{
			action: 'requestReviewer' as const,
			input: { ...repositoryInput, reviewerUsername: 'reviewer' },
		},
		{
			action: 'removeReviewerRequest' as const,
			input: { ...repositoryInput, reviewerUsername: 'reviewer' },
		},
		{
			action: 'submitReview' as const,
			input: {
				...repositoryInput,
				outcome: 'approve' as const,
				expectedHeadSha: 'reviewed-head',
			},
		},
		{
			action: 'discardPendingReview' as const,
			input: repositoryInput,
		},
	])('delegates $action with session and input', async ({ action, input }) => {
		const actionSpy = vi.spyOn(service, action).mockResolvedValue({} as never)
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
