import { createHmac } from 'node:crypto'
import { EnvService } from '@config/env'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubWebhookDeliveryId } from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncRepository } from '../infrastructure/github-sync.repository'
import { GitHubWebhookService } from './github-webhook.service'

const WEBHOOK_SECRET = 'test-webhook-secret'
const deliveryId =
	'00000000-0000-4000-8000-000000000111' as GitHubWebhookDeliveryId
const syncRequest = {
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	authorityGeneration: 2,
	requestedSyncVersion: 4,
}
const payload = {
	action: 'synchronize',
	installation: {
		id: 123,
		target_type: 'Organization',
		account: {
			id: 9,
			node_id: 'organization-node',
			login: 'tessera-org',
			type: 'Organization',
		},
	},
	repository: {
		id: 456,
		node_id: 'repository-node',
		name: 'notes',
		full_name: 'tessera-org/notes',
		html_url: 'https://github.com/tessera-org/notes',
		clone_url: 'https://github.com/tessera-org/notes.git',
		default_branch: 'main',
		owner: {
			id: 9,
			node_id: 'organization-node',
			login: 'tessera-org',
			type: 'Organization',
		},
	},
	sender: {
		id: 7,
		node_id: 'sender-node',
		login: 'marta',
		type: 'User',
	},
}

describe(GitHubWebhookService.name, () => {
	let moduleRef: TestingModule
	let service: GitHubWebhookService
	let repository: GitHubSyncRepository
	let queue: GitHubSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubWebhookService,
				{
					provide: EnvService,
					useValue: { get: vi.fn(() => WEBHOOK_SECRET) },
				},
				{
					provide: GitHubSyncRepository,
					useValue: { recordWebhookDelivery: vi.fn() },
				},
				{
					provide: GitHubSyncQueue,
					useValue: { enqueue: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(GitHubWebhookService)
		repository = moduleRef.get(GitHubSyncRepository)
		queue = moduleRef.get(GitHubSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('verifies, allowlists, persists, and enqueues a repository delivery', async () => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: false,
			syncRequests: [syncRequest],
		})
		const rawBody = Buffer.from(JSON.stringify(payload))

		expect(
			await service.receive({
				deliveryId,
				eventName: 'pull_request',
				rawBody,
				signature: sign(rawBody),
			})
		).toEqual({ accepted: true, duplicate: false })
		expect(repository.recordWebhookDelivery).toHaveBeenCalledWith({
			deliveryId,
			eventName: 'pull_request',
			action: 'synchronize',
			installation: {
				externalInstallationId: 123n,
				accountNodeId: 'organization-node',
				accountLogin: 'tessera-org',
				targetType: 'organization',
				suspendedAt: undefined,
			},
			externalRepositoryNodeId: 'repository-node',
			externalRepositoryNumericId: 456n,
			subjectNodeId: undefined,
			subjectNumber: undefined,
			issueNumber: undefined,
			targetResourceKind: 'pull_request',
			targetResourceNodeId: undefined,
			targetResourceNumericId: undefined,
			targetSha: undefined,
			targetContext: undefined,
			targetTeamNodeId: undefined,
			targetTeamSlug: undefined,
			sender: {
				nodeId: 'sender-node',
				numericId: 7n,
				login: 'marta',
				type: 'user',
				avatarUrl: undefined,
				htmlUrl: undefined,
			},
			targetActor: undefined,
			labelNodeId: undefined,
			labelName: undefined,
			addedInstallationRepositories: undefined,
			removedInstallationRepositories: undefined,
		})
		expect(queue.enqueue).toHaveBeenCalledWith(syncRequest)
	})

	test('rejects invalid signatures before parsing or persistence', async () => {
		const rawBody = Buffer.from('{not-json')

		await expect(
			service.receive({
				deliveryId,
				eventName: 'push',
				rawBody,
				signature: 'sha256=invalid',
			})
		).rejects.toThrow()
		expect(repository.recordWebhookDelivery).not.toHaveBeenCalled()
	})

	test('re-enqueues an outstanding duplicate delivery without versioning it again', async () => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: true,
			syncRequests: [syncRequest],
		})
		const rawBody = Buffer.from(JSON.stringify(payload))

		expect(
			await service.receive({
				deliveryId,
				eventName: 'push',
				rawBody,
				signature: sign(rawBody),
			})
		).toEqual({ accepted: true, duplicate: true })
		expect(queue.enqueue).toHaveBeenCalledWith(syncRequest)
	})

	test('accepts an abbreviated installation reference from a pull request event', async () => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: false,
			syncRequests: [],
		})
		const rawBody = Buffer.from(
			JSON.stringify({
				...payload,
				installation: { id: 123, node_id: 'installation-node' },
				pull_request: { node_id: 'pull-request-node', number: 7 },
			})
		)

		await service.receive({
			deliveryId,
			eventName: 'pull_request',
			rawBody,
			signature: sign(rawBody),
		})

		expect(repository.recordWebhookDelivery).toHaveBeenCalledWith(
			expect.objectContaining({
				installation: {
					externalInstallationId: 123n,
					suspendedAt: undefined,
				},
				subjectNodeId: 'pull-request-node',
				subjectNumber: 7,
			})
		)
	})

	test.each([
		{
			eventName: 'check_run',
			body: {
				action: 'completed',
				check_run: {
					id: 21,
					node_id: 'check-run-node',
					head_sha: 'head-sha',
					name: 'build',
				},
			},
			expected: {
				targetResourceKind: 'check_run',
				targetResourceNodeId: 'check-run-node',
				targetResourceNumericId: 21n,
				targetSha: 'head-sha',
				targetContext: 'build',
			},
		},
		{
			eventName: 'check_suite',
			body: {
				action: 'completed',
				check_suite: {
					id: 22,
					node_id: 'check-suite-node',
					head_sha: 'head-sha',
				},
			},
			expected: {
				targetResourceKind: 'check_suite',
				targetResourceNodeId: 'check-suite-node',
				targetResourceNumericId: 22n,
				targetSha: 'head-sha',
				targetContext: undefined,
			},
		},
		{
			eventName: 'status',
			body: {
				id: 33,
				node_id: 'status-node',
				sha: 'head-sha',
				context: 'ci/lint',
				state: 'success',
			},
			expected: {
				targetResourceKind: 'commit_status',
				targetResourceNodeId: 'status-node',
				targetResourceNumericId: 33n,
				targetSha: 'head-sha',
				targetContext: 'ci/lint',
			},
		},
	])('targets the commit a $eventName delivery names', async params => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: false,
			syncRequests: [],
		})
		const rawBody = Buffer.from(JSON.stringify({ ...payload, ...params.body }))

		await service.receive({
			deliveryId,
			eventName: params.eventName,
			rawBody,
			signature: sign(rawBody),
		})

		expect(repository.recordWebhookDelivery).toHaveBeenCalledWith(
			expect.objectContaining({
				...params.expected,
				subjectNumber: undefined,
			})
		)
	})

	test.each([
		{
			action: 'suspend',
			suspendedAt: '2026-08-05T10:00:00Z',
			expected: new Date('2026-08-05T10:00:00Z'),
		},
		{ action: 'unsuspend', suspendedAt: null, expected: null },
	])('maps the $action installation lifecycle action', async params => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: false,
			syncRequests: [],
		})
		const rawBody = Buffer.from(
			JSON.stringify({
				...payload,
				action: params.action,
				installation: {
					...payload.installation,
					suspended_at: params.suspendedAt,
				},
			})
		)

		await service.receive({
			deliveryId,
			eventName: 'installation',
			rawBody,
			signature: sign(rawBody),
		})

		expect(repository.recordWebhookDelivery).toHaveBeenCalledWith(
			expect.objectContaining({
				action: params.action,
				installation: expect.objectContaining({
					suspendedAt: params.expected,
				}),
			})
		)
	})

	test('preserves organization installations when target type is omitted', async () => {
		vi.spyOn(repository, 'recordWebhookDelivery').mockResolvedValue({
			accepted: true,
			duplicate: false,
			syncRequests: [],
		})
		const rawBody = Buffer.from(
			JSON.stringify({
				...payload,
				installation: {
					id: payload.installation.id,
					account: payload.installation.account,
				},
				sender: { ...payload.sender, type: 'EnterpriseUserAccount' },
			})
		)

		await service.receive({
			deliveryId,
			eventName: 'installation',
			rawBody,
			signature: sign(rawBody),
		})

		expect(repository.recordWebhookDelivery).toHaveBeenCalledWith(
			expect.objectContaining({
				installation: expect.objectContaining({
					targetType: 'organization',
				}),
				sender: expect.objectContaining({ type: 'user' }),
			})
		)
	})
})

function sign(rawBody: Buffer) {
	return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`
}
