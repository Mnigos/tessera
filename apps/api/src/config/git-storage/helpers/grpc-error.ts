/**
 * Reads the numeric gRPC status code from an unknown error value.
 */
export function getGrpcCode(error: unknown) {
	if (!error || typeof error !== 'object' || !('code' in error))
		return undefined

	return typeof error.code === 'number' ? error.code : undefined
}

/**
 * Reads the gRPC details string from an unknown error value.
 */
export function getGrpcDetails(error: unknown) {
	if (!error || typeof error !== 'object' || !('details' in error))
		return undefined

	return typeof error.details === 'string' ? error.details : undefined
}
