import { status } from '@grpc/grpc-js'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { InvalidGitAccessTokenError } from '@modules/git-access-tokens/domain/git-access-token.errors'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import type { ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, UserId } from '@repo/domain'
import { RepositoriesService } from '../application/repositories.service'
import { GitRepositoryWriteGuard } from './git-repository-write.guard'
import { getGitRepositoryWriteAuthorization } from './git-repository-write-authorization.context'

const ownerUserId = '00000000-0000-4000-8000-000000000001' as UserId
const otherUserId = '00000000-0000-4000-8000-000000000002' as UserId
const repositoryId = '00000000-0000-4000-8000-000000000003' as RepositoryId
const target = {
	id: repositoryId,
	ownerUserId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
}
const authorization = {
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
	trustedUser: ownerUserId,
}

describe(GitRepositoryWriteGuard.name, () => {
	let moduleRef: TestingModule
	let guard: GitRepositoryWriteGuard
	let gitAccessTokensService: GitAccessTokensService
	let sshPublicKeysService: SshPublicKeysService
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitRepositoryWriteGuard,
				{
					provide: GitAccessTokensService,
					useValue: { verify: vi.fn() },
				},
				{
					provide: SshPublicKeysService,
					useValue: { findOwnerByFingerprint: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: {
						getGitRepositoryWriteTarget: vi.fn(),
						completeGitRepositoryWriteAuthorization: vi.fn(),
					},
				},
			],
		}).compile()

		guard = moduleRef.get(GitRepositoryWriteGuard)
		gitAccessTokensService = moduleRef.get(GitAccessTokensService)
		sshPublicKeysService = moduleRef.get(SshPublicKeysService)
		repositoriesService = moduleRef.get(RepositoriesService)

		vi.spyOn(
			repositoriesService,
			'getGitRepositoryWriteTarget'
		).mockResolvedValue(target)
		vi.spyOn(
			repositoriesService,
			'completeGitRepositoryWriteAuthorization'
		).mockReturnValue(authorization)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('authorizes HTTP git writes for repository owners', async () => {
		vi.spyOn(gitAccessTokensService, 'verify').mockResolvedValue({
			userId: ownerUserId,
			permissions: { repository: ['write'] },
		})
		const request = createHttpWriteRequest()

		expect(await guard.canActivate(createGuardContext(request))).toBe(true)
		expect(gitAccessTokensService.verify).toHaveBeenCalledWith({
			rawToken: 'tes_git_raw-secret',
			requiredPermission: 'git:write',
		})
		expect(getGitRepositoryWriteAuthorization(request)).toBe(authorization)
	})

	test('authorizes SSH git writes for repository owners', async () => {
		vi.spyOn(sshPublicKeysService, 'findOwnerByFingerprint').mockResolvedValue(
			ownerUserId
		)
		const request = createSshWriteRequest()

		expect(await guard.canActivate(createGuardContext(request))).toBe(true)
		expect(sshPublicKeysService.findOwnerByFingerprint).toHaveBeenCalledWith(
			'SHA256:abc'
		)
		expect(getGitRepositoryWriteAuthorization(request)).toBe(authorization)
	})

	test('rejects write identities that do not own the repository', async () => {
		vi.spyOn(gitAccessTokensService, 'verify').mockResolvedValue({
			userId: otherUserId,
			permissions: { repository: ['write'] },
		})

		await expect(
			guard.canActivate(createGuardContext(createHttpWriteRequest()))
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.PERMISSION_DENIED }),
		})
	})

	test('maps invalid write credentials to unauthenticated', async () => {
		vi.spyOn(gitAccessTokensService, 'verify').mockRejectedValue(
			new InvalidGitAccessTokenError({ reason: 'invalid_token' })
		)

		await expect(
			guard.canActivate(createGuardContext(createHttpWriteRequest()))
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.UNAUTHENTICATED }),
		})
	})
})

function createHttpWriteRequest() {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-receive-pack',
		action: 'write',
		basicUsername: 'marta',
		token: 'tes_git_raw-secret',
	}
}

function createSshWriteRequest() {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-receive-pack',
		action: 'receive_pack',
		fingerprint: 'SHA256:abc',
	}
}

function createGuardContext(request: object): ExecutionContext {
	return {
		switchToRpc: () => ({
			getData: () => request,
		}),
	} as ExecutionContext
}
