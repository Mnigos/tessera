import type { ExecutionContext } from '@nestjs/common'
import type { UserId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { getTargetUserId } from './target-user-id.decorator'

describe(getTargetUserId.name, () => {
	test('extracts targetUserId from the request', () => {
		expect(
			getTargetUserId(undefined, createContext({ targetUserId: mockUserId }))
		).toBe(mockUserId)
	})

	test('returns undefined when the guard did not attach targetUserId', () => {
		expect(getTargetUserId(undefined, createContext({}))).toBeUndefined()
	})
})

interface DecoratorRequest {
	targetUserId?: UserId
}

function createContext(request: DecoratorRequest): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => request,
		}),
	} as ExecutionContext
}
