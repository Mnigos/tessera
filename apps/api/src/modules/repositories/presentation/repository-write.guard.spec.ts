import type { ExecutionContext } from '@nestjs/common'
import type { RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { RepositoriesService } from '../application/repositories.service'
import {
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
	RepositoryOwnerUsernameRequiredError,
} from '../domain/repository.errors'
import { RepositoryWriteGuard } from './repository-write.guard'

describe(RepositoryWriteGuard.name, () => {
	let guard: RepositoryWriteGuard
	let repositoriesService: RepositoriesService

	beforeEach(() => {
		repositoriesService = {
			assertViewerRepositoryWriteAccess: vi.fn().mockResolvedValue(undefined),
		} as unknown as RepositoriesService
		guard = new RepositoryWriteGuard(repositoriesService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('allows writers and attaches the viewer user id', async () => {
		const assertSpy = vi.spyOn(
			repositoriesService,
			'assertViewerRepositoryWriteAccess'
		)
		const request: GuardRequest = {
			params: { username: 'marta', slug: 'tessera-notes' },
			session: createMockSession({ username: 'marta' }),
		}

		expect(await guard.canActivate(createGuardContext(request))).toBe(true)
		expect(assertSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: 'tessera-notes' as RepositorySlug,
		})
	})

	test('rejects requests without a username path param', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					params: { slug: 'tessera-notes' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryOwnerUsernameRequiredError)
	})

	test('rejects requests without a slug path param', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'marta' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('masks the repository from unauthenticated requests', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'marta', slug: 'tessera-notes' },
				})
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('propagates denied write access from the service', async () => {
		vi.spyOn(
			repositoriesService,
			'assertViewerRepositoryWriteAccess'
		).mockRejectedValue(
			new RepositoryGitWriteForbiddenError({ username: 'ren' })
		)

		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren', slug: 'tessera-notes' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryGitWriteForbiddenError)
	})

	test('propagates hidden repositories as repository misses', async () => {
		vi.spyOn(
			repositoriesService,
			'assertViewerRepositoryWriteAccess'
		).mockRejectedValue(new RepositoryNotFoundError({ username: 'ren' }))

		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren', slug: 'tessera-notes' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})
})

interface GuardRequest {
	params?: Record<string, string>
	session?: ReturnType<typeof createMockSession>
	targetUserId?: string
	viewerUserId?: string
}

function createGuardContext(request: GuardRequest): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => request,
		}),
	} as ExecutionContext
}
