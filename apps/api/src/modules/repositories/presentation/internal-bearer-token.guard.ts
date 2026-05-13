import { EnvService } from '@config/env'
import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import { InternalGitRepositoryAuthorizationError } from '../domain/repository.errors'

interface HeaderRequest {
	headers?: Record<string, string | string[] | undefined>
}

@Injectable()
export class InternalBearerTokenGuard implements CanActivate {
	constructor(private readonly envService: EnvService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<HeaderRequest>()
		const authorization = this.getHeader(request, 'authorization')
		const expectedToken = this.envService.get('INTERNAL_API_TOKEN')

		if (!expectedToken || authorization !== `Bearer ${expectedToken}`)
			throw new InternalGitRepositoryAuthorizationError()

		return true
	}

	private getHeader(request: HeaderRequest, name: string): string | undefined {
		const header =
			request.headers?.[name] ?? request.headers?.[name.toLowerCase()]

		return Array.isArray(header) ? header[0] : header
	}
}
