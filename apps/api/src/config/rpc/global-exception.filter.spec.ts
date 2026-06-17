import { type ArgumentsHost, HttpStatus, Logger } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import { NotFoundError } from '~/shared/errors'
import { GlobalExceptionFilter } from './global-exception.filter'

function createMockHost(type: 'http' | 'rpc' = 'http'): ArgumentsHost {
	const response = {
		status: vi.fn(),
		json: vi.fn().mockReturnValue(new Response()),
		res: undefined as unknown,
	}

	return {
		switchToHttp: vi.fn(() => ({
			getResponse: () => response,
		})),
		getArgs: vi.fn(),
		getArgByIndex: vi.fn(),
		switchToRpc: vi.fn(),
		switchToWs: vi.fn(),
		getType: vi.fn().mockReturnValue(type),
	} as unknown as ArgumentsHost
}

function getResponse(host: ArgumentsHost) {
	return host.switchToHttp().getResponse<{
		status: ReturnType<typeof vi.fn>
		json: ReturnType<typeof vi.fn>
		res: unknown
	}>()
}

describe(GlobalExceptionFilter.name, () => {
	beforeEach(() => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('writes resolved oRPC error responses to Hono context', () => {
		const filter = new GlobalExceptionFilter()
		const host = createMockHost()

		filter.catch(new NotFoundError('profile'), host)

		const response = getResponse(host)
		expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
		expect(response.json).toHaveBeenCalledWith({
			defined: false,
			code: 'NOT_FOUND',
			status: HttpStatus.NOT_FOUND,
			message: 'profile not found',
		})
		expect(response.res).toBeInstanceOf(Response)
	})

	test('passes rpc exceptions through to the grpc exception handler', () => {
		const filter = new GlobalExceptionFilter()
		const host = createMockHost('rpc')
		const exception = new RpcException({
			code: 7,
			message: 'repository git write access denied',
		})

		expect(() => filter.catch(exception, host)).toThrow(exception)
	})

	test('passes non-rpc exceptions through in rpc contexts', () => {
		const filter = new GlobalExceptionFilter()
		const host = createMockHost('rpc')
		const exception = new Error('boom')

		expect(() => filter.catch(exception, host)).toThrow(exception)
		expect(host.switchToHttp).not.toHaveBeenCalled()
	})
})
