import { UserService } from '@modules/user'
import { ProfileNotFoundError } from '@modules/user/domain/user.errors'
import type { ExecutionContext } from '@nestjs/common'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import {
	RepositoryNotFoundError,
	RepositoryOwnerUsernameRequiredError,
} from '../domain/repository.errors'
import { RepositoryOwnerGuard } from './repository-owner.guard'

describe(RepositoryOwnerGuard.name, () => {
	let guard: RepositoryOwnerGuard
	let userService: UserService

	beforeEach(() => {
		userService = {
			findUserId: vi.fn(),
		} as unknown as UserService
		guard = new RepositoryOwnerGuard(userService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('attaches target and viewer user ids for the owner username path param', async () => {
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
		const promise = guard.canActivate(
			createGuardContext({
				session: createMockSession({ username: 'marta' }),
			})
		)

		await expect(promise).rejects.toBeInstanceOf(
			RepositoryOwnerUsernameRequiredError
		)
		await expect(promise).rejects.toMatchObject({
			context: {
				field: 'username',
				location: 'path',
				reason: 'missing_path_param',
				resource: 'repository owner username',
			},
			message: 'Repository owner username is required',
		})
	})

	test('hides requests without a viewer session user id', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'marta' },
				})
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('hides requests for another user id', async () => {
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
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('hides missing target usernames as repository misses', async () => {
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
