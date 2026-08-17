import {
	type NotifyPushRequest,
	PushRefUpdateKind,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Test, type TestingModule } from '@nestjs/testing'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestPushNotificationInvalidError } from '../domain/pull-request.errors'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { PullRequestPushEventsService } from './pull-request-push-events.service'

const repositoryId = '00000000-0000-4000-8000-000000000002'
const operationId = '00000000-0000-4000-8000-000000000077'
const occurredAt = new Date('2026-07-11T00:00:00Z')
const oldSha = '1111111111111111111111111111111111111111'
const newSha = '2222222222222222222222222222222222222222'
const notification: NotifyPushRequest = {
	operationId,
	repositoryId,
	actorUserId: mockUserId,
	occurredAtUnixMs: occurredAt.getTime(),
	updates: [
		{
			refName: 'refs/heads/feature',
			oldSha,
			newSha,
			kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
		},
	],
}

describe(PullRequestPushEventsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestPushEventsService
	let pullRequestsRepository: PullRequestsRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestPushEventsService,
				{
					provide: PullRequestsRepository,
					useValue: {
						createPushEvents: vi.fn(),
						clearBranchDiffStats: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestPushEventsService)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)

		vi.spyOn(pullRequestsRepository, 'createPushEvents').mockResolvedValue(1)
		vi.spyOn(pullRequestsRepository, 'clearBranchDiffStats').mockResolvedValue()
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('records a branch movement against the branch the ref names', async () => {
		await service.record(notification)

		expect(pullRequestsRepository.createPushEvents).toHaveBeenCalledWith({
			repositoryId,
			actorUserId: mockUserId,
			operationId,
			occurredAt,
			updates: [
				{
					ref: 'refs/heads/feature',
					sourceBranch: 'feature',
					oldSha,
					newSha,
					type: 'head_updated',
				},
			],
		})
		expect(pullRequestsRepository.clearBranchDiffStats).toHaveBeenCalledWith({
			repositoryId,
			branches: ['feature'],
		})
	})

	test('records a rewritten branch as a force push', async () => {
		await service.record({
			...notification,
			updates: [
				{
					refName: 'refs/heads/feature',
					oldSha,
					newSha,
					kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_FORCE_PUSHED,
				},
			],
		})

		expect(pullRequestsRepository.createPushEvents).toHaveBeenCalledWith(
			expect.objectContaining({
				updates: [expect.objectContaining({ type: 'force_pushed' })],
			})
		)
	})

	test('accepts a push time delivered as a string', async () => {
		await service.record({
			...notification,
			occurredAtUnixMs: String(occurredAt.getTime()) as unknown as number,
		})

		expect(pullRequestsRepository.createPushEvents).toHaveBeenCalledWith(
			expect.objectContaining({ occurredAt })
		)
	})

	test.each([
		['an unqualified ref', { refName: 'feature' }],
		['a tag', { refName: 'refs/tags/v1' }],
		['a ref with a double dot', { refName: 'refs/heads/foo..bar' }],
		['a ref with a reflog selector', { refName: 'refs/heads/foo@{1}' }],
		['a ref with a space', { refName: 'refs/heads/foo bar' }],
		['a ref ending in a separator', { refName: 'refs/heads/foo/' }],
		['a ref ending in .lock', { refName: 'refs/heads/foo.lock' }],
		['an empty branch', { refName: 'refs/heads/' }],
		['a branch creation', { oldSha: '0'.repeat(40) }],
		['a branch deletion', { newSha: '0'.repeat(40) }],
		['a malformed commit', { newSha: 'not-a-sha' }],
		['a branch that did not move', { newSha: oldSha }],
		[
			'an unclassified movement',
			{ kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_UNSPECIFIED },
		],
	])('refuses %s', async (_, update) => {
		const record = service.record({
			...notification,
			updates: [{ ...notification.updates[0], ...update }],
		} as NotifyPushRequest)

		await expect(record).rejects.toBeInstanceOf(
			PullRequestPushNotificationInvalidError
		)
		expect(pullRequestsRepository.createPushEvents).not.toHaveBeenCalled()
	})

	test.each([
		['an invalid repository', { repositoryId: 'not-a-uuid' }],
		['an invalid actor', { actorUserId: 'not-a-uuid' }],
		['an invalid operation', { operationId: 'not-a-uuid' }],
		['no push time', { occurredAtUnixMs: 0 }],
		[
			'a push time no date can hold',
			{ occurredAtUnixMs: 8_640_000_000_000_001 },
		],
		['no updates', { updates: [] }],
		[
			'more updates than any push carries',
			{
				updates: Array.from({ length: 1001 }, (_unused, index) => ({
					refName: `refs/heads/feature-${index}`,
					oldSha,
					newSha,
					kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
				})),
			},
		],
	])('refuses a notification with %s', async (_, overrides) => {
		const record = service.record({ ...notification, ...overrides })

		await expect(record).rejects.toBeInstanceOf(
			PullRequestPushNotificationInvalidError
		)
		expect(pullRequestsRepository.createPushEvents).not.toHaveBeenCalled()
	})
})
