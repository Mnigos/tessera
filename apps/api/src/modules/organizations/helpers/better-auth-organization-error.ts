import { ORGANIZATION_SLUG_TAKEN_BY_USER_CODE } from '@repo/auth'
import { isAPIError } from 'better-auth/api'
import {
	BadRequestError,
	InternalError,
	UnauthorizedError,
} from '~/shared/errors'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'

/**
 * The last line of defence for a handle: two creations racing past every
 * application check still meet this index.
 */
const ORGANIZATION_SLUG_CONSTRAINTS = new Set(['organization_slug_unique'])

/**
 * Better Auth codes the reasons it refuses; the ones Tessera has an opinion
 * about are named here so the rest fall through to the status mapping.
 */
const SLUG_TAKEN_CODES = new Set<string>([
	'ORGANIZATION_ALREADY_EXISTS',
	'ORGANIZATION_SLUG_ALREADY_TAKEN',
	ORGANIZATION_SLUG_TAKEN_BY_USER_CODE,
])
const NOT_FOUND_CODES = new Set([
	'ORGANIZATION_NOT_FOUND',
	'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
	'YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION',
])
const PERMISSION_DENIED_CODES = new Set([
	'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION',
	'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
	'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION',
])

/**
 * Turns whatever a Better Auth organization write threw into a Tessera error.
 *
 * Three kinds of failure arrive here. The handle conflicts are races rather
 * than duplicated policy — Tessera settles the handle before it calls, so
 * Better Auth and the unique index only reach the same conclusion when
 * something arrived in between. The coded refusals are Better Auth's own rules,
 * chiefly the role check that runs against the caller's real session. Anything
 * else still gets a status rather than escaping as an `APIError` nothing
 * downstream recognizes, which the exception filter would report as a 500.
 */
export function toOrganizationApiError(
	error: unknown,
	context?: Record<string, unknown>
): unknown {
	if (isUniqueViolation(error, ORGANIZATION_SLUG_CONSTRAINTS))
		return new OrganizationSlugTakenError(context)

	if (!isAPIError(error)) return error

	const code = error.body?.code

	if (code !== undefined) {
		if (SLUG_TAKEN_CODES.has(code))
			return new OrganizationSlugTakenError(context)

		if (NOT_FOUND_CODES.has(code)) return new OrganizationNotFoundError(context)

		if (PERMISSION_DENIED_CODES.has(code))
			return new OrganizationPermissionDeniedError({ ...context, reason: code })
	}

	const errorContext = { ...context, reason: code ?? error.status }

	switch (error.status) {
		case 'BAD_REQUEST':
			return new BadRequestError('organization request', errorContext)
		case 'UNAUTHORIZED':
			return new UnauthorizedError('organization', errorContext)
		case 'FORBIDDEN':
			return new OrganizationPermissionDeniedError(errorContext)
		case 'NOT_FOUND':
			return new OrganizationNotFoundError(errorContext)
		default:
			return new InternalError('organization', errorContext, undefined, {
				cause: error,
			})
	}
}
