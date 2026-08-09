import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvService } from '@config/env'
import {
	GIT_GRPC_LOADER_OPTIONS,
	resolveGitAuthorizationProtoPath,
} from '@config/git-storage'
import {
	GIT_PUSH_EVENTS_SERVICE_NAME,
	type GitPushEventsServiceClient,
	type NotifyPushRequest,
	PushRefUpdateKind,
	TESSERA_GIT_V1_PACKAGE_NAME,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Metadata, status } from '@grpc/grpc-js'
import { PullRequestPushEventsService } from '@modules/pull-requests/application/pull-request-push-events.service'
import { PullRequestsRepository } from '@modules/pull-requests/infrastructure/pull-requests.repository'
import { GitPushEventsGrpcController } from '@modules/pull-requests/presentation/git-push-events.grpc.controller'
import { InternalGitAuthorizationGuard } from '@modules/repositories'
import type { INestMicroservice } from '@nestjs/common'
import {
	type ClientGrpc,
	ClientProxyFactory,
	Transport,
} from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import {
	type PullRequest,
	pullRequestEvents,
	pullRequests,
	repositories,
	user,
} from '@repo/db/schema'
import type {
	PullRequestId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { asc, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { firstValueFrom } from 'rxjs'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const ownerUserId = '00000000-0000-4000-8000-000000000001' as UserId
const repositoryId = '00000000-0000-4000-8000-000000000101' as RepositoryId
const otherRepositoryId = '00000000-0000-4000-8000-000000000102' as RepositoryId
const operationId = '00000000-0000-4000-8000-000000000201'
const occurredAt = new Date('2026-08-08T10:00:00.000Z')
const oldSha = '1'.repeat(40)
const newSha = '2'.repeat(40)

interface ClosableGrpcClient extends ClientGrpc {
	close(): Promise<void>
}

interface CreateIntegrationPullRequestOptions {
	id: PullRequestId
	number: number
	repositoryId?: RepositoryId
	sourceBranch?: string
	targetBranch?: string
	provider?: PullRequest['provider']
	state?: PullRequest['state']
	createdAt?: Date
}

describe('Git push events gRPC integration', () => {
	let moduleRef: TestingModule
	let app: INestMicroservice
	let client: ClosableGrpcClient
	let service: GitPushEventsServiceClient

	beforeAll(async () => {
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		const port = await getAvailablePort()

		moduleRef = await Test.createTestingModule({
			imports: [DatabaseModule],
			controllers: [GitPushEventsGrpcController],
			providers: [
				PullRequestPushEventsService,
				PullRequestsRepository,
				InternalGitAuthorizationGuard,
				{
					provide: EnvService,
					useValue: {
						get: vi.fn().mockReturnValue('test-internal-token'),
					},
				},
			],
		}).compile()

		app = moduleRef.createNestMicroservice({
			transport: Transport.GRPC,
			options: {
				loader: GIT_GRPC_LOADER_OPTIONS,
				package: TESSERA_GIT_V1_PACKAGE_NAME,
				protoPath: resolveGitAuthorizationProtoPath(),
				url: `localhost:${port}`,
			},
		})
		await app.listen()

		client = ClientProxyFactory.create({
			transport: Transport.GRPC,
			options: {
				loader: GIT_GRPC_LOADER_OPTIONS,
				package: TESSERA_GIT_V1_PACKAGE_NAME,
				protoPath: resolveGitAuthorizationProtoPath(),
				url: `localhost:${port}`,
			},
		}) as unknown as ClosableGrpcClient
		service = client.getService<GitPushEventsServiceClient>(
			GIT_PUSH_EVENTS_SERVICE_NAME
		)
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		await createIntegrationUser()
		await createIntegrationRepository(repositoryId, 'notes' as RepositorySlug)
		await createIntegrationRepository(
			otherRepositoryId,
			'archive' as RepositorySlug
		)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await client.close()
		await app.close()
		await moduleRef.close()
	})

	test('rejects a notification without the internal bearer token', async () => {
		await expect(
			firstValueFrom(
				service.notifyPush(createNotifyPushRequest(), new Metadata())
			)
		).rejects.toMatchObject({ code: status.UNAUTHENTICATED })
	})

	test('rejects a notification carrying the wrong internal bearer token', async () => {
		const metadata = new Metadata()
		metadata.set('authorization', 'Bearer not-the-internal-token')

		await expect(
			firstValueFrom(service.notifyPush(createNotifyPushRequest(), metadata))
		).rejects.toMatchObject({ code: status.UNAUTHENTICATED })
	})

	test('records a fast-forward as a head update on the pull request the branch backs', async () => {
		const pullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})

		expect(
			await firstValueFrom(
				service.notifyPush(createNotifyPushRequest(), createMetadata())
			)
		).toEqual({})

		const [event] = await listEvents(pullRequestId)
		expect(event).toMatchObject({
			type: 'head_updated',
			provider: 'tessera',
			actorUserId: ownerUserId,
			payload: { ref: 'refs/heads/feature', oldSha, newSha },
			idempotencyKey: `git-push:${operationId}:refs/heads/feature`,
			createdAt: occurredAt,
		})
	})

	test('records a rewritten branch as a force push', async () => {
		const pullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})

		await firstValueFrom(
			service.notifyPush(
				createNotifyPushRequest({
					updates: [
						{
							refName: 'refs/heads/feature',
							oldSha,
							newSha,
							kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_FORCE_PUSHED,
						},
					],
				}),
				createMetadata()
			)
		)

		const [event] = await listEvents(pullRequestId)
		expect(event?.type).toBe('force_pushed')
	})

	test('fans out to every open pull request the branch backs', async () => {
		const firstPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
			targetBranch: 'main',
		})
		const secondPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000302' as PullRequestId,
			number: 2,
			targetBranch: 'release',
		})

		await firstValueFrom(
			service.notifyPush(createNotifyPushRequest(), createMetadata())
		)

		expect(await listEvents(firstPullRequestId)).toHaveLength(1)
		expect(await listEvents(secondPullRequestId)).toHaveLength(1)
	})

	test.each([
		['closed', { state: 'closed' as const }],
		['merged', { state: 'merged' as const }],
		['synchronized from GitHub', { provider: 'github' as const }],
		['in another repository', { repositoryId: otherRepositoryId }],
		['opened from another branch', { sourceBranch: 'other' }],
		['opened after the push', { createdAt: new Date('2026-08-08T11:00:00Z') }],
	])('ignores a pull request that is %s', async (_, overrides) => {
		const pullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
			...overrides,
		})

		await firstValueFrom(
			service.notifyPush(createNotifyPushRequest(), createMetadata())
		)

		expect(await listEvents(pullRequestId)).toHaveLength(0)
	})

	test('acknowledges a repeated delivery without recording it twice', async () => {
		const pullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})

		await firstValueFrom(
			service.notifyPush(createNotifyPushRequest(), createMetadata())
		)
		expect(
			await firstValueFrom(
				service.notifyPush(createNotifyPushRequest(), createMetadata())
			)
		).toEqual({})

		expect(await listEvents(pullRequestId)).toHaveLength(1)
	})

	test('records both branches of one push under one operation', async () => {
		const firstPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})
		const secondPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000302' as PullRequestId,
			number: 2,
			sourceBranch: 'other',
		})

		await firstValueFrom(
			service.notifyPush(
				createNotifyPushRequest({
					updates: [
						...createNotifyPushRequest().updates,
						{
							refName: 'refs/heads/other',
							oldSha,
							newSha,
							kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_FORCE_PUSHED,
						},
					],
				}),
				createMetadata()
			)
		)

		expect(await listEvents(firstPullRequestId)).toMatchObject([
			{ type: 'head_updated' },
		])
		expect(await listEvents(secondPullRequestId)).toMatchObject([
			{ type: 'force_pushed' },
		])
	})

	test('refuses a malformed notification permanently', async () => {
		await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})

		await expect(
			firstValueFrom(
				service.notifyPush(
					createNotifyPushRequest({ repositoryId: 'not-a-uuid' }),
					createMetadata()
				)
			)
		).rejects.toMatchObject({ code: status.INVALID_ARGUMENT })
	})

	test('writes nothing when a delivery cannot be recorded', async () => {
		const pullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})

		await expect(
			firstValueFrom(
				service.notifyPush(
					createNotifyPushRequest({
						actorUserId: '00000000-0000-4000-8000-000000000009',
					}),
					createMetadata()
				)
			)
		).rejects.toMatchObject({ code: status.INTERNAL })

		expect(await listEvents(pullRequestId)).toHaveLength(0)
	})

	test('rolls back the events it already wrote when a later branch fails', async () => {
		const firstPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000301' as PullRequestId,
			number: 1,
		})
		const secondPullRequestId = await createIntegrationPullRequest({
			id: '00000000-0000-4000-8000-000000000302' as PullRequestId,
			number: 2,
			sourceBranch: 'other',
		})
		// Fails the second branch of the fan-out only, after the first has
		// already been written inside the same transaction.
		await db.execute(
			sql`alter table pull_request_events add constraint pull_request_events_integration_check check (payload->>'ref' is distinct from 'refs/heads/other')`
		)

		try {
			await expect(
				firstValueFrom(
					service.notifyPush(
						createNotifyPushRequest({
							updates: [
								...createNotifyPushRequest().updates,
								{
									refName: 'refs/heads/other',
									oldSha,
									newSha,
									kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
								},
							],
						}),
						createMetadata()
					)
				)
			).rejects.toMatchObject({ code: status.INTERNAL })

			expect(await listEvents(firstPullRequestId)).toHaveLength(0)
			expect(await listEvents(secondPullRequestId)).toHaveLength(0)
		} finally {
			await db.execute(
				sql`alter table pull_request_events drop constraint pull_request_events_integration_check`
			)
		}
	})

	test('indexes the delivery key and the open source branch lookup', async () => {
		const indexes = await db.execute<{
			indexname: string
			indexdef: string
		}>(
			sql`select indexname, indexdef from pg_indexes where indexname in ('pull_request_events_idempotency_key_unique', 'pull_requests_open_source_branch_idx') order by indexname`
		)

		expect([...indexes]).toMatchObject([
			{
				indexname: 'pull_request_events_idempotency_key_unique',
				indexdef: expect.stringContaining(
					'USING btree (pull_request_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)'
				),
			},
			{
				indexname: 'pull_requests_open_source_branch_idx',
				indexdef: expect.stringContaining(
					'USING btree (repository_id, source_branch)'
				),
			},
		])
		expect([...indexes][0]?.indexdef).toContain('CREATE UNIQUE INDEX')
	})
})

function createNotifyPushRequest(
	overrides: Partial<NotifyPushRequest> = {}
): NotifyPushRequest {
	return {
		operationId,
		repositoryId,
		actorUserId: ownerUserId,
		occurredAtUnixMs: occurredAt.getTime(),
		updates: [
			{
				refName: 'refs/heads/feature',
				oldSha,
				newSha,
				kind: PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
			},
		],
		...overrides,
	}
}

function createMetadata() {
	const metadata = new Metadata()
	metadata.set('authorization', 'Bearer test-internal-token')

	return metadata
}

async function listEvents(pullRequestId: PullRequestId) {
	return await db
		.select()
		.from(pullRequestEvents)
		.where(eq(pullRequestEvents.pullRequestId, pullRequestId))
		.orderBy(asc(pullRequestEvents.createdAt))
}

async function createIntegrationUser() {
	await db.insert(user).values({
		id: ownerUserId,
		name: 'Marta',
		username: 'marta',
		email: 'marta@example.com',
		emailVerified: true,
	})
}

async function createIntegrationRepository(
	id: RepositoryId,
	slug: RepositorySlug
) {
	await db.insert(repositories).values({
		id,
		ownerUserId,
		name: 'Notes' as RepositoryName,
		slug,
		visibility: 'private',
		storagePath: `/var/lib/tessera/repositories/${id}.git`,
	})
}

async function createIntegrationPullRequest({
	createdAt = new Date('2026-08-08T09:00:00Z'),
	id,
	number,
	provider = 'tessera',
	repositoryId: pullRequestRepositoryId = repositoryId,
	sourceBranch = 'feature',
	state = 'open',
	targetBranch = 'main',
}: CreateIntegrationPullRequestOptions) {
	await db.insert(pullRequests).values({
		id,
		repositoryId: pullRequestRepositoryId,
		provider,
		number,
		authorUserId: ownerUserId,
		sourceBranch,
		targetBranch,
		openingBaseSha: oldSha,
		openingHeadSha: newSha,
		title: 'Add feature',
		state,
		createdAt,
		...(state === 'open'
			? {}
			: {
					closedAt: createdAt,
					...(state === 'merged'
						? {
								mergedAt: createdAt,
								mergeCommitSha: newSha,
								mergeActorUserId: ownerUserId,
							}
						: {}),
				}),
	})

	return id
}

async function resetIntegrationDatabase() {
	await db.delete(pullRequestEvents)
	await db.delete(pullRequests)
	await db.delete(repositories)
	await db.delete(user)
}

async function getAvailablePort() {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer()
		server.on('error', reject)
		server.listen(0, () => {
			const address = server.address()
			if (!(address && typeof address === 'object')) {
				server.close()
				reject(new Error('failed to allocate test port'))
				return
			}

			const { port } = address
			server.close(error => {
				if (error) reject(error)
				else resolve(port)
			})
		})
	})
}
