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

type OrganizationErrorFactory = (context: Record<string, unknown>) => unknown

const ORGANIZATION_ERROR_BY_CODE = new Map<string, OrganizationErrorFactory>([
	[ORGANIZATION_SLUG_TAKEN_BY_USER_CODE, toSlugTakenError],
	['ORGANIZATION_ALREADY_EXISTS', toSlugTakenError],
	['ORGANIZATION_SLUG_ALREADY_TAKEN', toSlugTakenError],
	['ORGANIZATION_NOT_FOUND', toOrganizationNotFoundError],
	['USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION', toOrganizationNotFoundError],
	['YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION', toOrganizationNotFoundError],
	['MEMBER_NOT_FOUND', context => new OrganizationMemberNotFoundError(context)],
	[
		'INVITATION_NOT_FOUND',
		context => new OrganizationInvitationNotFoundError(context),
	],
	[
		'FAILED_TO_RETRIEVE_INVITATION',
		context => new OrganizationInvitationNotFoundError(context),
	],
	['YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER', toLastOwnerError],
	['YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER', toLastOwnerError],
	[
		'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
		context => new OrganizationMemberAlreadyExistsError(context),
	],
	[
		'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
		context => new OrganizationInvitationPendingError(context),
	],
	[
		'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
		context => new OrganizationInvitationEmailMismatchError(context),
	],
	['INVITATION_LIMIT_REACHED', toLimitReachedError],
	['ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', toLimitReachedError],
	['YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION', toPermissionDeniedError],
	['YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION', toPermissionDeniedError],
	['YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION', toPermissionDeniedError],
	['YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER', toPermissionDeniedError],
	['YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION', toPermissionDeniedError],
	[
		'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
		toPermissionDeniedError,
	],
	[
		'YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE',
		toPermissionDeniedError,
	],
	['YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER', toPermissionDeniedError],
	['YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION', toPermissionDeniedError],
])

function toSlugTakenError(context: Record<string, unknown>) {
	return new OrganizationSlugTakenError(context)
}

function toOrganizationNotFoundError(context: Record<string, unknown>) {
	return new OrganizationNotFoundError(context)
}

function toLastOwnerError(context: Record<string, unknown>) {
	return new OrganizationLastOwnerError(context)
}

function toLimitReachedError(context: Record<string, unknown>) {
	return new OrganizationLimitReachedError(context)
}

function toPermissionDeniedError(context: Record<string, unknown>) {
	return new OrganizationPermissionDeniedError(context)
}

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
	const toCodedError = code ? ORGANIZATION_ERROR_BY_CODE.get(code) : undefined

	if (toCodedError) return toCodedError(errorContext)

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
