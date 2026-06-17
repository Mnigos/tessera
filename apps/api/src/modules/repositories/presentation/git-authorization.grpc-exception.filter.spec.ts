import { status } from '@grpc/grpc-js'
import type { ArgumentsHost } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import { GitAuthorizationGrpcExceptionFilter } from './git-authorization.grpc-exception.filter'
import { createGitAuthorizationRpcException } from './git-authorization.grpc-status'

describe(GitAuthorizationGrpcExceptionFilter.name, () => {
	test('passes git authorization rpc status details to grpc-js', async () => {
		const filter = new GitAuthorizationGrpcExceptionFilter()

		await expect(
			firstValueFrom(
				filter.catch(
					createGitAuthorizationRpcException(
						status.PERMISSION_DENIED,
						'repository git write access denied'
					),
					{} as ArgumentsHost
				)
			)
		).rejects.toMatchObject({
			code: status.PERMISSION_DENIED,
			details: 'repository git write access denied',
		})
	})

	test('maps unknown exceptions to internal grpc-js service errors', async () => {
		const filter = new GitAuthorizationGrpcExceptionFilter()

		await expect(
			firstValueFrom(filter.catch(new Error('boom'), {} as ArgumentsHost))
		).rejects.toMatchObject({
			code: status.INTERNAL,
			details: 'Internal error',
		})
	})
})
