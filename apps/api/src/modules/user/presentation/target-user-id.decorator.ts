import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { UserId } from '@repo/domain'
import type { AppRequest } from '~/shared/types/app-request'

export function getTargetUserId(
	_data: unknown,
	context: ExecutionContext
): UserId | undefined {
	const request = context.switchToHttp().getRequest<AppRequest>()
	return request.targetUserId
}

export const TargetUserId = createParamDecorator(getTargetUserId)
