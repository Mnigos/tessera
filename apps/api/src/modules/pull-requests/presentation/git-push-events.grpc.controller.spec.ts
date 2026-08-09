import { EnvService } from '@config/env'
import {
	type NotifyPushRequest,
	PushRefUpdateKind,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { status } from '@grpc/grpc-js'
import { RpcException } from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestPushEventsService } from '../application/pull-request-push-events.service'
import { PullRequestPushNotificationInvalidError } from '../domain/pull-request.errors'
import { GitPushEventsGrpcController } from './git-push-events.grpc.controller'

describe(GitPushEventsGrpcController.name, () => {
	let moduleRef: TestingModule
	let controller: GitPushEventsGrpcController
	let pullRequestPushEventsService: PullRequestPushEventsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [GitPushEventsGrpcController],
			providers: [
				{
					provide: PullRequestPushEventsService,
					useValue: { record: vi.fn() },
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn().mockReturnValue('test-internal-token'),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(GitPushEventsGrpcController)
		pullRequestPushEventsService = moduleRef.get(PullRequestPushEventsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('acknowledges a recorded push', async () => {
		vi.spyOn(pullRequestPushEventsService, 'record').mockResolvedValue()

		await expect(
			controller.notifyPush(createNotifyPushRequest())
		).resolves.toEqual({})
	})

	test('refuses a malformed notification permanently', async () => {
		vi.spyOn(pullRequestPushEventsService, 'record').mockRejectedValue(
			new PullRequestPushNotificationInvalidError()
		)

		await expect(
			controller.notifyPush(createNotifyPushRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
		})
	})

	test('leaves an unexpected failure retryable', async () => {
		vi.spyOn(pullRequestPushEventsService, 'record').mockRejectedValue(
			new Error('boom')
		)

		await expect(
			controller.notifyPush(createNotifyPushRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({
				code: status.INTERNAL,
				message: 'Internal error',
			}),
		})
	})

	test('passes through existing rpc exceptions', async () => {
		const rpcException = new RpcException({
			code: status.UNAVAILABLE,
			message: 'database unavailable',
		})
		vi.spyOn(pullRequestPushEventsService, 'record').mockRejectedValue(
			rpcException
		)

		await expect(controller.notifyPush(createNotifyPushRequest())).rejects.toBe(
			rpcException
		)
	})
})

function createNotifyPushRequest(): NotifyPushRequest {
	return {
		operationId: '00000000-0000-4000-8000-000000000077',
		repositoryId: '00000000-0000-4000-8000-000000000002',
		actorUserId: mockUserId,
		occurredAtUnixMs: new Date('2026-07-11T00:00:00Z').getTime(),
		updates: [
			{
				refName: 'refs/heads/feature',
				oldSha: '1111111111111111111111111111111111111111',
				newSha: '2222222222222222222222222222222222222222',
				kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
			},
		],
	}
}
