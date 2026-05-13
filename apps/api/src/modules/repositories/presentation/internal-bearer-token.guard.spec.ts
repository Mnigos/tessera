import { EnvService } from '@config/env'
import type { ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { InternalGitRepositoryAuthorizationError } from '../domain/repository.errors'
import { InternalBearerTokenGuard } from './internal-bearer-token.guard'

describe(InternalBearerTokenGuard.name, () => {
	let moduleRef: TestingModule
	let guard: InternalBearerTokenGuard
	let envService: EnvService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				InternalBearerTokenGuard,
				{
					provide: EnvService,
					useValue: {
						get: vi.fn().mockReturnValue('internal-token'),
					},
				},
			],
		}).compile()

		guard = moduleRef.get(InternalBearerTokenGuard)
		envService = moduleRef.get(EnvService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('allows matching bearer tokens', () => {
		expect(
			guard.canActivate(
				createGuardContext({ authorization: 'Bearer internal-token' })
			)
		).toBe(true)
	})

	test('rejects missing bearer tokens', () => {
		expect(() => guard.canActivate(createGuardContext({}))).toThrow(
			InternalGitRepositoryAuthorizationError
		)
	})

	test('rejects invalid bearer tokens', () => {
		expect(() =>
			guard.canActivate(
				createGuardContext({ authorization: 'Bearer wrong-token' })
			)
		).toThrow(InternalGitRepositoryAuthorizationError)
	})

	test('rejects requests when the internal token is not configured', () => {
		vi.spyOn(envService, 'get').mockReturnValue(undefined)

		expect(() =>
			guard.canActivate(
				createGuardContext({ authorization: 'Bearer internal-token' })
			)
		).toThrow(InternalGitRepositoryAuthorizationError)
	})
})

function createGuardContext(headers: Record<string, string>): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({ headers }),
		}),
	} as ExecutionContext
}
