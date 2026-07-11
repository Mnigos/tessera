import { UserService } from '@modules/user'
import { ProfileNotFoundError } from '@modules/user/domain/user.errors'
import type { ExecutionContext } from '@nestjs/common'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import {
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
	RepositoryOwnerUsernameRequiredError,
} from '../domain/repository.errors'
import { RepositoryWriteGuard } from './repository-write.guard'

describe(RepositoryWriteGuard.name, () => {
	let guard: RepositoryWriteGuard
	let userService: UserService

	beforeEach(() => {
		userService = {
			findUserId: vi.fn(),
		} as unknown as UserService
		guard = new RepositoryWriteGuard(userService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('allows repository owner writes and attaches resolved user ids', async () => {
		const findUserIdSpy = vi
			.spyOn(userService, 'findUserId')
			.mockResolvedValue(mockUserId)
		const request: GuardRequest = {
			params: { username: 'marta' },
			session: createMockSession({ username: 'marta' }),
		}

		expect(await guard.canActivate(createGuardContext(request))).toBe(true)
		expect(findUserIdSpy).toHaveBeenCalledWith({ username: 'marta' })
		expect(request.targetUserId).toBe(mockUserId)
		expect(request.viewerUserId).toBe(mockUserId)
	})

	test('rejects requests without a username path param', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryOwnerUsernameRequiredError)
	})

	test('rejects requests without an authenticated user', async () => {
		await expect(
			guard.canActivate(createGuardContext({ params: { username: 'marta' } }))
		).rejects.toBeInstanceOf(RepositoryGitWriteForbiddenError)
	})

	test('rejects repository writes by another user', async () => {
		vi.spyOn(userService, 'findUserId').mockResolvedValue(
			'00000000-0000-4000-8000-000000000009' as typeof mockUserId
		)

		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryGitWriteForbiddenError)
	})

	test('maps missing target users to repository misses', async () => {
		vi.spyOn(userService, 'findUserId').mockRejectedValue(
			new ProfileNotFoundError('ren')
		)

		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('propagates unexpected user lookup errors', async () => {
		const error = new Error('profile lookup failed')
		vi.spyOn(userService, 'findUserId').mockRejectedValue(error)

		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).rejects.toBe(error)
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
