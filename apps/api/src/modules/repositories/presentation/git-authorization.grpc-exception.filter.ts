import { status } from '@grpc/grpc-js'
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common'
import { throwError } from 'rxjs'
import {
	createGitAuthorizationGrpcStatusException,
	toGitAuthorizationGrpcStatusException,
} from './git-authorization.grpc-status'

@Catch()
export class GitAuthorizationGrpcExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, _host: ArgumentsHost) {
		const statusException = toGitAuthorizationGrpcStatusException(exception)

		return throwError(
			() =>
				statusException ??
				createGitAuthorizationGrpcStatusException(
					status.INTERNAL,
					'Internal error'
				)
		)
	}
}
