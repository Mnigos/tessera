import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common'
import type { Context } from 'hono'
import { resolveException } from './exception-resolution.helper'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		if (host.getType() === 'rpc') throw exception

		const response = host.switchToHttp().getResponse<Context>()
		const { code, message, status } = resolveException(exception)

		response.status(status as Parameters<Context['status']>[0])
		response.res = response.json({
			defined: false,
			code,
			status,
			message,
		})
	}
}
