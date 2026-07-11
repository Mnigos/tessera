import { RepositoryWriteGuard } from '@modules/repositories'
import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequest } from '@repo/contracts'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { PullRequestsService } from '../application/pull-requests.service'
import { PullRequestsController } from './pull-requests.controller'

const session = createMockSession()
const createdAt = new Date('2026-07-11T00:00:00Z')
const pullRequest: PullRequest = {
	id: '00000000-0000-4000-8000-000000000044' as PullRequestId,
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	number: 1,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'head-sha',
	title: 'Add feature',
	body: '',
	state: 'open',
	mergeCommitSha: undefined,
	mergeActorUserId: undefined,
	createdAt,
	updatedAt: createdAt,
	closedAt: undefined,
	mergedAt: undefined,
}
const repositoryInput = { username: 'marta', slug: 'notes' as const }

describe(PullRequestsController.name, () => {
	let moduleRef: TestingModule
	let controller: PullRequestsController
	let service: PullRequestsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [PullRequestsController],
			providers: [
				{
					provide: RepositoryWriteGuard,
					useValue: { canActivate: vi.fn() },
				},
				{
					provide: UserService,
					useValue: { findUserId: vi.fn() },
				},
				{
					provide: PullRequestsService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						get: vi.fn(),
						edit: vi.fn(),
						close: vi.fn(),
						reopen: vi.fn(),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(PullRequestsController)
		service = moduleRef.get(PullRequestsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests with the authenticated user', async () => {
		const input = {
			...repositoryInput,
			sourceBranch: 'feature',
			targetBranch: 'main',
			title: 'Add feature',
		}
		const createSpy = vi.spyOn(service, 'create').mockResolvedValue(pullRequest)
		const procedure = controller.create(session)

		expect(
			await procedure['~orpc'].handler({
				input,
				context: {},
				path: ['pullRequests', 'create'],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(pullRequest)
		expect(createSpy).toHaveBeenCalledWith(mockUserId, input)
	})

	test('delegates anonymous list requests', async () => {
		const listSpy = vi.spyOn(service, 'list').mockResolvedValue([pullRequest])
		const procedure = controller.list()

		expect(
			await procedure['~orpc'].handler({
				input: repositoryInput,
				context: {},
				path: ['pullRequests', 'list'],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ pullRequests: [pullRequest] })
		expect(listSpy).toHaveBeenCalledWith(undefined, repositoryInput)
	})

	test('delegates get requests with an optional viewer', async () => {
		const output = { pullRequest, events: [] }
		const getSpy = vi.spyOn(service, 'get').mockResolvedValue(output)
		const input = { ...repositoryInput, number: 1 }
		const procedure = controller.get(session)

		expect(
			await procedure['~orpc'].handler({
				input,
				context: {},
				path: ['pullRequests', 'get'],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(output)
		expect(getSpy).toHaveBeenCalledWith(mockUserId, input)
	})

	test.each([
		'edit',
		'close',
		'reopen',
	] as const)('delegates %s requests with the authenticated user', async action => {
		const input =
			action === 'edit'
				? { ...repositoryInput, number: 1, title: 'Updated' }
				: { ...repositoryInput, number: 1 }
		const actionSpy = vi.spyOn(service, action).mockResolvedValue(pullRequest)
		const procedure = controller[action](session)

		expect(
			await procedure['~orpc'].handler({
				input,
				context: {},
				path: ['pullRequests', action],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(pullRequest)
		expect(actionSpy).toHaveBeenCalledWith(mockUserId, input)
	})
})
