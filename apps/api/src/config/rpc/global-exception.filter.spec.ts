import { type ArgumentsHost, HttpStatus, Logger } from '@nestjs/common'
import { NotFoundError } from '~/shared/errors'
import { GlobalExceptionFilter } from './global-exception.filter'

function createMockHost(): ArgumentsHost {
	const response = {
		status: vi.fn(),
		json: vi.fn().mockReturnValue(new Response()),
		res: undefined as unknown,
	}

	return {
		switchToHttp: () => ({
			getResponse: () => response,
		}),
		getArgs: vi.fn(),
		getArgByIndex: vi.fn(),
		switchToRpc: vi.fn(),
		switchToWs: vi.fn(),
		getType: vi.fn(),
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
			defined: true,
			code: 'NOT_FOUND',
			message: 'profile not found',
		})
		expect(response.res).toBeInstanceOf(Response)
	})
})
