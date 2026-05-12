import type { ExecutionContext } from '@nestjs/common'
import { createMockSession } from '~/shared/test-utils'
import { RepositoryNotFoundError } from '../domain/repository.errors'
import { RepositoryOwnerGuard } from './repository-owner.guard'

describe(RepositoryOwnerGuard.name, () => {
	const guard = new RepositoryOwnerGuard()

	test('allows requests for the authenticated username path param', () => {
		expect(
			guard.canActivate(
				createGuardContext({
					params: { username: 'marta' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).toBe(true)
	})

	test('hides requests when the session has no username', () => {
		expect(() =>
			guard.canActivate(
				createGuardContext({
					params: { username: 'marta' },
					session: createMockSession({ username: null }),
				})
			)
		).toThrow(RepositoryNotFoundError)
	})

	test('hides requests for another username', () => {
		expect(() =>
			guard.canActivate(
				createGuardContext({
					params: { username: 'ren' },
					session: createMockSession({ username: 'marta' }),
				})
			)
		).toThrow(RepositoryNotFoundError)
	})
})

interface GuardRequest {
	params?: Record<string, string>
	session?: ReturnType<typeof createMockSession>
}

function createGuardContext(request: GuardRequest): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => request,
		}),
	} as ExecutionContext
}
