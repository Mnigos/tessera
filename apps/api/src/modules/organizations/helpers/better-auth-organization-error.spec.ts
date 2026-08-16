import { APIError } from 'better-auth/api'
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
import { toOrganizationApiError } from './better-auth-organization-error'

describe(toOrganizationApiError.name, () => {
	test.each([
		['ORGANIZATION_SLUG_TAKEN_BY_USER', OrganizationSlugTakenError],
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
	] as const)('maps Better Auth code %s', (code, ErrorClass) => {
		expect(
			toOrganizationApiError(
				new APIError('BAD_REQUEST', { code, message: 'rejected' })
			)
		).toBeInstanceOf(ErrorClass)
	})

	test.each([
		['organization_slug_unique', OrganizationSlugTakenError],
		['member_organization_user_unique', OrganizationMemberAlreadyExistsError],
		['invitation_pending_email_unique', OrganizationInvitationPendingError],
	] as const)('maps unique constraint %s', (constraintName, ErrorClass) => {
		expect(
			toOrganizationApiError({
				code: '23505',
				constraint_name: constraintName,
			})
		).toBeInstanceOf(ErrorClass)
	})

	test('preserves code and caller context on a mapped error', () => {
		expect(
			toOrganizationApiError(
				new APIError('FORBIDDEN', {
					code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER',
					message: 'rejected',
				}),
				{ memberId: 'member-id' }
			)
		).toSatisfy(
			(error: unknown) =>
				error instanceof OrganizationPermissionDeniedError &&
				error.context?.memberId === 'member-id' &&
				error.context?.reason === 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER'
		)
	})

	test.each([
		['BAD_REQUEST', 'BAD_REQUEST'],
		['UNAUTHORIZED', 'UNAUTHORIZED'],
		['FORBIDDEN', 'FORBIDDEN'],
		['NOT_FOUND', 'NOT_FOUND'],
		['INTERNAL_SERVER_ERROR', 'INTERNAL_SERVER_ERROR'],
	] as const)('maps Better Auth status %s to %s', (status, code) => {
		expect(
			toOrganizationApiError(
				new APIError(status, { message: 'provider detail' })
			)
		).toMatchObject({ code })
	})

	test('leaves non-Better Auth errors unchanged', () => {
		const error = new Error('boom')

		expect(toOrganizationApiError(error)).toBe(error)
	})
})
