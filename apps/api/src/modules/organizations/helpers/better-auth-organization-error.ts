import { ORGANIZATION_SLUG_TAKEN_BY_USER_CODE } from '@repo/auth'
import { isAPIError } from 'better-auth/api'
import {
	BadRequestError,
	InternalError,
	UnauthorizedError,
} from '~/shared/errors'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	OrganizationInvitationEmailMismatchError,
	OrganizationInvitationNotFoundError,
	OrganizationInvitationPendingError,
	OrganizationLastOwnerError,
	OrganizationLimitReachedError,
	OrganizationMemberAlreadyExistsError,
	OrganizationMemberNotFoundError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'

const ORGANIZATION_SLUG_CONSTRAINTS = new Set(['organization_slug_unique'])

const ORGANIZATION_MEMBER_CONSTRAINTS = new Set([
	'member_organization_user_unique',
])
const ORGANIZATION_INVITATION_CONSTRAINTS = new Set([
	'invitation_pending_email_unique',
])

type OrganizationErrorClass = new (context?: Record<string, unknown>) => unknown

const ORGANIZATION_ERROR_BY_CODE = new Map<string, OrganizationErrorClass>([
	[ORGANIZATION_SLUG_TAKEN_BY_USER_CODE, OrganizationSlugTakenError],
	['ORGANIZATION_ALREADY_EXISTS', OrganizationSlugTakenError],
	['ORGANIZATION_SLUG_ALREADY_TAKEN', OrganizationSlugTakenError],
	['ORGANIZATION_NOT_FOUND', OrganizationNotFoundError],
	['USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION', OrganizationNotFoundError],
	['YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION', OrganizationNotFoundError],
	['MEMBER_NOT_FOUND', OrganizationMemberNotFoundError],
	['INVITATION_NOT_FOUND', OrganizationInvitationNotFoundError],
	['FAILED_TO_RETRIEVE_INVITATION', OrganizationInvitationNotFoundError],
	[
		'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
		OrganizationLastOwnerError,
	],
	[
		'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
		OrganizationLastOwnerError,
	],
	[
		'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
		OrganizationMemberAlreadyExistsError,
	],
	[
		'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
		OrganizationInvitationPendingError,
	],
	[
		'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
		OrganizationInvitationEmailMismatchError,
	],
	['INVITATION_LIMIT_REACHED', OrganizationLimitReachedError],
	['ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', OrganizationLimitReachedError],
	[
		'YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER',
		OrganizationPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
		OrganizationPermissionDeniedError,
	],
])

export function toOrganizationApiError(
	error: unknown,
	context?: Record<string, unknown>
): unknown {
	if (isUniqueViolation(error, ORGANIZATION_SLUG_CONSTRAINTS))
		return new OrganizationSlugTakenError(context)

	if (isUniqueViolation(error, ORGANIZATION_MEMBER_CONSTRAINTS))
		return new OrganizationMemberAlreadyExistsError(context)

	if (isUniqueViolation(error, ORGANIZATION_INVITATION_CONSTRAINTS))
		return new OrganizationInvitationPendingError(context)

	if (!isAPIError(error)) return error

	const code = error.body?.code
	const errorContext = { ...context, reason: code ?? error.status }
	const CodedError = code ? ORGANIZATION_ERROR_BY_CODE.get(code) : undefined

	if (CodedError) return new CodedError(errorContext)

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
