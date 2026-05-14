import { EnvService } from '@config/env'
import { type Metadata, status } from '@grpc/grpc-js'
import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'

const BEARER_PREFIX = 'Bearer '

@Injectable()
export class InternalGitAuthorizationGuard implements CanActivate {
	constructor(private readonly envService: EnvService) {}

	canActivate(context: ExecutionContext): boolean {
		const metadata = context.switchToRpc().getContext<Metadata | undefined>()
		const [authorization] = metadata?.get('authorization') ?? []
		const authorizationToken =
			typeof authorization === 'string' &&
			authorization.startsWith(BEARER_PREFIX)
				? authorization.slice(BEARER_PREFIX.length)
				: undefined
		const expectedToken = this.envService.get('INTERNAL_API_TOKEN')

		if (!expectedToken || authorizationToken !== expectedToken)
			throw new RpcException({
				code: status.UNAUTHENTICATED,
				message: 'Unauthorized',
			})

		return true
	}
}
