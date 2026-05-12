interface DatabaseConstraintError {
	code?: string
	constraint_name?: string
	constraint?: string
	cause?: unknown
}

const UNIQUE_VIOLATION_CODE = '23505'

export function isUniqueViolation(
	error: unknown,
	constraints?: ReadonlySet<string>
) {
	const constraintError = findDatabaseConstraintError(error)

	if (!constraintError || constraintError.code !== UNIQUE_VIOLATION_CODE)
		return false

	if (!constraints) return true

	return constraints.has(
		constraintError.constraint_name ?? constraintError.constraint ?? ''
	)
}

function findDatabaseConstraintError(
	error: unknown
): DatabaseConstraintError | undefined {
	if (!isDatabaseConstraintError(error)) return undefined
	if (error.code) return error

	return findDatabaseConstraintError(error.cause)
}

function isDatabaseConstraintError(
	error: unknown
): error is DatabaseConstraintError {
	return typeof error === 'object' && error !== null
}
