import { createServer } from 'node:net'
import { resolveGitAuthorizationProtoPath } from '@config/git-storage'
import {
	GIT_AUTHORIZATION_SERVICE_NAME,
	type GitAuthorizationServiceClient,
	TESSERA_GIT_V1_PACKAGE_NAME,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Metadata, status } from '@grpc/grpc-js'
import { RepositoriesService } from '@modules/repositories/application/repositories.service'
import { GitAuthorizationGrpcController } from '@modules/repositories/presentation/git-authorization.grpc.controller'
import { type INestMicroservice } from '@nestjs/common'
import {
	type ClientGrpc,
	ClientProxyFactory,
	Transport,
} from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { firstValueFrom } from 'rxjs'
import { UnauthorizedError } from '~/shared/errors'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

interface ClosableGrpcClient extends ClientGrpc {
	close(): Promise<void>
}

describe('Git authorization gRPC integration', () => {
	let moduleRef: TestingModule
	let app: INestMicroservice
	let client: ClosableGrpcClient
	let service: GitAuthorizationServiceClient
	let repositoriesService: Pick<
		RepositoriesService,
		'authorizeGitRepositoryRead' | 'authorizeGitRepositoryWrite'
	>

	beforeAll(async () => {
		const port = await getAvailablePort()
		repositoriesService = {
			authorizeGitRepositoryRead: vi.fn(),
			authorizeGitRepositoryWrite: vi.fn(),
		}

		moduleRef = await Test.createTestingModule({
			controllers: [GitAuthorizationGrpcController],
			providers: [
				{
					provide: RepositoriesService,
					useValue: repositoriesService,
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

	afterEach(() => {
		vi.clearAllMocks()
	})

	afterAll(async () => {
		await client.close()
		await app.close()
		await moduleRef.close()
	})

	test('authorizes read requests through the generated gRPC transport', async () => {
		vi.mocked(repositoriesService.authorizeGitRepositoryRead).mockResolvedValue(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedUser: '',
			}
		)

		expect(
			await firstValueFrom(
				service.authorizeRead(
					{
						ownerUsername: 'marta',
						repositorySlug: 'notes',
						service: 'git-upload-pack',
						action: 'info_refs',
					},
					createMetadata()
				)
			)
		).toEqual({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '',
		})
		expect(repositoriesService.authorizeGitRepositoryRead).toHaveBeenCalledWith(
			{
				internalAuthorization: 'Bearer test-internal-token',
				username: 'marta',
				slug: 'notes',
			}
		)
	})

	test('authorizes write requests and serializes trusted user through grpc', async () => {
		vi.mocked(
			repositoriesService.authorizeGitRepositoryWrite
		).mockResolvedValue({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		})

		expect(
			await firstValueFrom(
				service.authorizeWrite(
					{
						ownerUsername: 'marta',
						repositorySlug: 'notes',
						service: 'git-receive-pack',
						action: 'receive_pack',
						basicUsername: 'marta',
						token: 'tes_git_raw-secret',
					},
					createMetadata()
				)
			)
		).toEqual({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		})
		expect(
			repositoriesService.authorizeGitRepositoryWrite
		).toHaveBeenCalledWith({
			internalAuthorization: 'Bearer test-internal-token',
			username: 'marta',
			slug: 'notes',
			rawToken: 'tes_git_raw-secret',
		})
	})

	test('maps authorization failures through grpc status codes', async () => {
		vi.mocked(
			repositoriesService.authorizeGitRepositoryWrite
		).mockRejectedValue(new UnauthorizedError('git authorization'))

		await expect(
			firstValueFrom(
				service.authorizeWrite(
					{
						ownerUsername: 'marta',
						repositorySlug: 'notes',
						service: 'git-receive-pack',
						action: 'receive_pack',
						basicUsername: 'marta',
						token: 'tes_git_raw-secret',
					},
					createMetadata()
				)
			)
		).rejects.toMatchObject({ code: status.UNAUTHENTICATED })
	})
})

function createMetadata() {
	const metadata = new Metadata()
	metadata.set('authorization', 'Bearer test-internal-token')

	return metadata
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
