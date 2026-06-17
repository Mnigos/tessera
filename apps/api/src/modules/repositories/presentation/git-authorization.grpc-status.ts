import { RpcException } from '@nestjs/microservices'

interface GrpcStatusException extends Error {
	code: number
	details: string
}

interface GitAuthorizationRpcPayload {
	code: number
	message?: string
	details?: string
}

interface RpcExceptionLike {
	getError: () => unknown
}

export function createGitAuthorizationRpcException(
	code: number,
	message: string
) {
	return new RpcException(
		createGitAuthorizationGrpcStatusException(code, message)
	)
}

export function isGitAuthorizationRpcException(
	error: unknown
): error is RpcExceptionLike {
	return hasRpcPayloadGetter(error)
}

export function createGitAuthorizationGrpcStatusException(
	code: number,
	message: string
) {
	const error = new Error(message) as GrpcStatusException
	error.code = code
	error.details = message

	return error
}

export function toGitAuthorizationGrpcStatusException(exception: unknown) {
	const payload = getRpcPayload(exception)

	return getGrpcStatusException(payload)
}

function getRpcPayload(exception: unknown) {
	if (hasRpcPayloadGetter(exception)) return exception.getError()

	return exception
}

function hasRpcPayloadGetter(error: unknown): error is RpcExceptionLike {
	return (
		typeof error === 'object' &&
		error !== null &&
		'getError' in error &&
		typeof error.getError === 'function'
	)
}

function getGrpcStatusException(payload: unknown) {
	if (isGrpcStatusException(payload)) return payload
	if (!isGitAuthorizationRpcPayload(payload)) return undefined

	const message = payload.details ?? payload.message ?? 'Internal error'

	return createGitAuthorizationGrpcStatusException(payload.code, message)
}

function isGrpcStatusException(
	payload: unknown
): payload is GrpcStatusException {
	return payload instanceof Error && hasGrpcStatus(payload)
}

function isGitAuthorizationRpcPayload(
	payload: unknown
): payload is GitAuthorizationRpcPayload {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		hasGrpcStatus(payload) &&
		('message' in payload || 'details' in payload)
	)
}

function hasGrpcStatus(payload: object): payload is { code: number } {
	return (
		'code' in payload &&
		typeof payload.code === 'number' &&
		Number.isInteger(payload.code)
	)
}
