import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvService } from '@config/env'
import {
	GitStorageClient,
	resolveGitAuthorizationProtoPath,
} from '@config/git-storage'
import {
	GIT_AUTHORIZATION_SERVICE_NAME,
	type GitAuthorizationServiceClient,
	TESSERA_GIT_V1_PACKAGE_NAME,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Metadata, status } from '@grpc/grpc-js'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { InvalidGitAccessTokenError } from '@modules/git-access-tokens/domain/git-access-token.errors'
import { RepositoriesService } from '@modules/repositories/application/repositories.service'
import { RepositoriesRepository } from '@modules/repositories/infrastructure/repositories.repository'
import { GitAuthorizationGrpcController } from '@modules/repositories/presentation/git-authorization.grpc.controller'
import { InternalGitAuthorizationGuard } from '@modules/repositories/presentation/internal-git-authorization.guard'
import { type INestMicroservice } from '@nestjs/common'
import {
	type ClientGrpc,
	ClientProxyFactory,
	Transport,
} from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import { repositories, user } from '@repo/db/schema'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { firstValueFrom } from 'rxjs'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const ownerUserId = '00000000-0000-4000-8000-000000000001' as UserId
const otherUserId = '00000000-0000-4000-8000-000000000002' as UserId
const publicRepositoryId =
	'00000000-0000-4000-8000-000000000101' as RepositoryId
const privateRepositoryId =
	'00000000-0000-4000-8000-000000000102' as RepositoryId

interface ClosableGrpcClient extends ClientGrpc {
	close(): Promise<void>
}

interface CreateIntegrationUserOptions {
	userId: UserId
	username: string
	email: string
}

interface CreateIntegrationRepositoryOptions {
	id: RepositoryId
	ownerUserId: UserId
	slug: RepositorySlug
	visibility: RepositoryVisibility
	storagePath?: string | null
}

describe('Git authorization gRPC integration', () => {
	let moduleRef: TestingModule
	let app: INestMicroservice
	let client: ClosableGrpcClient
	let service: GitAuthorizationServiceClient
	let gitAccessTokensService: Pick<GitAccessTokensService, 'verify'>

	beforeAll(async () => {
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		const port = await getAvailablePort()
		gitAccessTokensService = {
			verify: vi.fn(),
		}

		moduleRef = await Test.createTestingModule({
			imports: [DatabaseModule],
			controllers: [GitAuthorizationGrpcController],
			providers: [
				RepositoriesService,
				RepositoriesRepository,
				InternalGitAuthorizationGuard,
				{
					provide: GitStorageClient,
					useValue: {},
				},
				{
					provide: GitAccessTokensService,
					useValue: gitAccessTokensService,
				},
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
				package: TESSERA_GIT_V1_PACKAGE_NAME,
				protoPath: resolveGitAuthorizationProtoPath(),
				url: `localhost:${port}`,
			},
		})
		await app.listen()

		client = ClientProxyFactory.create({
			transport: Transport.GRPC,
			options: {
				package: TESSERA_GIT_V1_PACKAGE_NAME,
				protoPath: resolveGitAuthorizationProtoPath(),
				url: `localhost:${port}`,
			},
		}) as unknown as ClosableGrpcClient
		service = client.getService<GitAuthorizationServiceClient>(
			GIT_AUTHORIZATION_SERVICE_NAME
		)
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		vi.mocked(gitAccessTokensService.verify).mockReset()
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await client.close()
		await app.close()
		await moduleRef.close()
	})

	test('authorizes read requests for public repositories through real service and database boundaries', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		await createIntegrationRepository({
			id: publicRepositoryId,
			ownerUserId,
			slug: 'notes' as RepositorySlug,
			visibility: 'public',
		})

		expect(
			await firstValueFrom(
				service.authorizeRead(createReadRequest(), createMetadata())
			)
		).toEqual({
			repositoryId: publicRepositoryId,
			storagePath: `/var/lib/tessera/repositories/${publicRepositoryId}.git`,
			trustedUser: '',
		})
	})

	test('rejects read requests for private repositories through grpc permission status', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		await createIntegrationRepository({
			id: privateRepositoryId,
			ownerUserId,
			slug: 'notes' as RepositorySlug,
			visibility: 'private',
		})

		await expect(
			firstValueFrom(
				service.authorizeRead(createReadRequest(), createMetadata())
			)
		).rejects.toMatchObject({ code: status.PERMISSION_DENIED })
	})

	test('authorizes write requests with a valid git access token', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		await createIntegrationRepository({
			id: privateRepositoryId,
			ownerUserId,
			slug: 'notes' as RepositorySlug,
			visibility: 'private',
		})
		vi.mocked(gitAccessTokensService.verify).mockResolvedValue({
			userId: ownerUserId,
			permissions: {
				repository: ['write'],
			},
		})

		expect(
			await firstValueFrom(
				service.authorizeWrite(createWriteRequest(), createMetadata())
			)
		).toEqual({
			repositoryId: privateRepositoryId,
			storagePath: `/var/lib/tessera/repositories/${privateRepositoryId}.git`,
			trustedUser: ownerUserId,
		})
		expect(gitAccessTokensService.verify).toHaveBeenCalledWith({
			rawToken: 'tes_git_raw-secret',
			requiredPermission: 'git:write',
		})
	})

	test('rejects write requests with an invalid git access token', async () => {
		vi.mocked(gitAccessTokensService.verify).mockRejectedValue(
			new InvalidGitAccessTokenError({ reason: 'invalid_token' })
		)

		await expect(
			firstValueFrom(
				service.authorizeWrite(createWriteRequest(), createMetadata())
			)
		).rejects.toMatchObject({ code: status.UNAUTHENTICATED })
	})

	test('rejects write requests when the token belongs to a different user', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		await createIntegrationRepository({
			id: privateRepositoryId,
			ownerUserId,
			slug: 'notes' as RepositorySlug,
			visibility: 'private',
		})
		vi.mocked(gitAccessTokensService.verify).mockResolvedValue({
			userId: otherUserId,
			permissions: {
				repository: ['write'],
			},
		})

		await expect(
			firstValueFrom(
				service.authorizeWrite(createWriteRequest(), createMetadata())
			)
		).rejects.toMatchObject({ code: status.PERMISSION_DENIED })
	})

	test('rejects write requests for missing repositories', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		vi.mocked(gitAccessTokensService.verify).mockResolvedValue({
			userId: ownerUserId,
			permissions: {
				repository: ['write'],
			},
		})

		await expect(
			firstValueFrom(
				service.authorizeWrite(createWriteRequest(), createMetadata())
			)
		).rejects.toMatchObject({ code: status.NOT_FOUND })
	})

	test('rejects write requests when repository storage path is missing', async () => {
		await createIntegrationUser({
			userId: ownerUserId,
			username: 'marta',
			email: 'marta@example.com',
		})
		await createIntegrationRepository({
			id: privateRepositoryId,
			ownerUserId,
			slug: 'notes' as RepositorySlug,
			visibility: 'private',
			storagePath: null,
		})
		vi.mocked(gitAccessTokensService.verify).mockResolvedValue({
			userId: ownerUserId,
			permissions: {
				repository: ['write'],
			},
		})

		await expect(
			firstValueFrom(
				service.authorizeWrite(createWriteRequest(), createMetadata())
			)
		).rejects.toMatchObject({ code: status.FAILED_PRECONDITION })
	})

	test('rejects requests without internal authorization metadata before service delegation', async () => {
		await expect(
			firstValueFrom(service.authorizeRead(createReadRequest()))
		).rejects.toMatchObject({ code: status.UNAUTHENTICATED })
		expect(gitAccessTokensService.verify).not.toHaveBeenCalled()
	})
})

function createReadRequest() {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-upload-pack',
		action: 'info_refs',
	}
}

function createWriteRequest() {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-receive-pack',
		action: 'receive_pack',
		basicUsername: 'marta',
		token: 'tes_git_raw-secret',
	}
}

function createMetadata() {
	const metadata = new Metadata()
	metadata.set('authorization', 'Bearer test-internal-token')

	return metadata
}

async function createIntegrationUser({
	email,
	userId,
	username,
}: CreateIntegrationUserOptions) {
	await db.insert(user).values({
		id: userId,
		name: username,
		email,
		emailVerified: true,
		username,
	})
}

async function createIntegrationRepository({
	id,
	ownerUserId,
	slug,
	storagePath = `/var/lib/tessera/repositories/${id}.git`,
	visibility,
}: CreateIntegrationRepositoryOptions) {
	await db.insert(repositories).values({
		id,
		ownerUserId,
		name: 'Notes' as RepositoryName,
		slug,
		visibility,
		storagePath,
	})
}

async function resetIntegrationDatabase() {
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
