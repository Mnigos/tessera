import { EnvService } from '@config/env'
import { Metadata } from '@grpc/grpc-js'
import type { ExecutionContext } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import { InternalGitAuthorizationGuard } from './internal-git-authorization.guard'

describe(InternalGitAuthorizationGuard.name, () => {
	let guard: InternalGitAuthorizationGuard
	let envService: EnvService

	beforeEach(() => {
		envService = {
			get: vi.fn().mockReturnValue('test-internal-token'),
		} as unknown as EnvService
		guard = new InternalGitAuthorizationGuard(envService)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('allows requests with a matching bearer token', () => {
		expect(
			guard.canActivate(
				createGuardContext(createMetadata('Bearer test-internal-token'))
			)
		).toBe(true)
	})

	test('rejects missing authorization metadata', () => {
		expect(() => guard.canActivate(createGuardContext(undefined))).toThrow(
			RpcException
		)
	})

	test('rejects malformed bearer metadata', () => {
		expect(() =>
			guard.canActivate(
				createGuardContext(createMetadata('test-internal-token'))
			)
		).toThrow(RpcException)
	})

	test('rejects mismatched bearer tokens', () => {
		expect(() =>
			guard.canActivate(
				createGuardContext(createMetadata('Bearer wrong-token'))
			)
		).toThrow(RpcException)
	})

	test('rejects requests when the internal token is not configured', () => {
		vi.spyOn(envService, 'get').mockReturnValue(undefined)

		expect(() =>
			guard.canActivate(
				createGuardContext(createMetadata('Bearer test-internal-token'))
			)
		).toThrow(RpcException)
	})
})

function createMetadata(authorization: string) {
	const metadata = new Metadata()
	metadata.set('authorization', authorization)

	return metadata
}

function createGuardContext(metadata: Metadata | undefined): ExecutionContext {
	return {
		switchToRpc: () => ({
			getContext: () => metadata,
		}),
	} as ExecutionContext
}
