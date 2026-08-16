import { APIError } from 'better-auth/api'
import {
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'
import { toOrganizationApiError } from './better-auth-organization-error'

describe(toOrganizationApiError.name, () => {
	test.each([
		'ORGANIZATION_ALREADY_EXISTS',
		'ORGANIZATION_SLUG_ALREADY_TAKEN',
		'ORGANIZATION_SLUG_TAKEN_BY_USER',
	])('maps Better Auth code %s to a taken-handle error', code => {
		expect(
			toOrganizationApiError(
				new APIError('BAD_REQUEST', { code, message: 'rejected' })
			)
		).toBeInstanceOf(OrganizationSlugTakenError)
	})

	test('maps the organization slug unique constraint to a taken-handle error', () => {
		expect(
			toOrganizationApiError({
				code: '23505',
				constraint_name: 'organization_slug_unique',
			})
		).toBeInstanceOf(OrganizationSlugTakenError)
	})

	test('maps Better Auth membership and permission errors', () => {
		expect(
			toOrganizationApiError(
				new APIError('NOT_FOUND', {
					code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
					message: 'missing',
				})
			)
		).toBeInstanceOf(OrganizationNotFoundError)
		expect(
			toOrganizationApiError(
				new APIError('FORBIDDEN', {
					code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
					message: 'forbidden',
				})
			)
		).toBeInstanceOf(OrganizationPermissionDeniedError)
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
