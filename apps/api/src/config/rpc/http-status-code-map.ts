import { HttpStatus } from '@nestjs/common'

export type SupportedORPCErrorCode =
	| 'BAD_REQUEST'
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'TOO_MANY_REQUESTS'
	| 'PAYLOAD_TOO_LARGE'
	| 'INTERNAL_SERVER_ERROR'
	| 'BAD_GATEWAY'
	| 'SERVICE_UNAVAILABLE'
	| 'GATEWAY_TIMEOUT'

const statusCodePairs: [HttpStatus, SupportedORPCErrorCode][] = [
	[HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
	[HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
	[HttpStatus.FORBIDDEN, 'FORBIDDEN'],
	[HttpStatus.NOT_FOUND, 'NOT_FOUND'],
	[HttpStatus.CONFLICT, 'CONFLICT'],
	[HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS'],
	[HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE'],
	[HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR'],
	[HttpStatus.BAD_GATEWAY, 'BAD_GATEWAY'],
	[HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
	[HttpStatus.GATEWAY_TIMEOUT, 'GATEWAY_TIMEOUT'],
]

const httpStatusToOrpcCodeMap = new Map(statusCodePairs)
const orpcCodeToHttpStatusMap = new Map<string, HttpStatus>(
	statusCodePairs.map(([status, code]) => [code, status])
)

export function httpStatusToOrpcCode(status: number): SupportedORPCErrorCode {
	return httpStatusToOrpcCodeMap.get(status) ?? 'INTERNAL_SERVER_ERROR'
}

export function orpcCodeToHttpStatus(code: string): number {
	return orpcCodeToHttpStatusMap.get(code) ?? HttpStatus.INTERNAL_SERVER_ERROR
}
