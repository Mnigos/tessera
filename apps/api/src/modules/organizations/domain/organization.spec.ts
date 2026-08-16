import type { OrganizationId } from '@repo/domain'
import {
	betterAuthOrganizationToOutput,
	toOrganizationMembershipOutput,
	toOrganizationOutput,
} from './organization'

const createdAt = new Date('2026-08-16T10:00:00.000Z')
const organization = {
	id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	slug: 'tessera',
	name: 'Tessera',
	logo: 'https://example.com/logo.png',
	createdAt,
}

describe(toOrganizationOutput.name, () => {
	test('maps a stored organization to its contract output', () => {
		expect(toOrganizationOutput(organization)).toEqual({
			id: organization.id,
			slug: 'tessera',
			name: 'Tessera',
			logoUrl: 'https://example.com/logo.png',
			createdAt,
		})
	})

	test.each([
		null,
		'',
		'not-a-url',
		'ftp://example.com/logo.png',
	])('omits an invalid stored logo value %s', logo => {
		expect(toOrganizationOutput({ ...organization, logo }).logoUrl).toBe(
			undefined
		)
	})
})

describe(toOrganizationMembershipOutput.name, () => {
	test('includes the viewer role in a membership output', () => {
		expect(
			toOrganizationMembershipOutput({ ...organization, role: 'admin' })
		).toMatchObject({ id: organization.id, role: 'admin' })
	})
})

describe(betterAuthOrganizationToOutput.name, () => {
	test.each([
		undefined,
		null,
	])('maps a Better Auth organization with a %s logo', logo => {
		expect(
			betterAuthOrganizationToOutput({
				id: organization.id,
				slug: 'tessera',
				name: 'Tessera',
				logo,
				createdAt,
			})
		).toEqual({
			id: organization.id,
			slug: 'tessera',
			name: 'Tessera',
			logoUrl: undefined,
			createdAt,
		})
	})

	test('keeps a valid Better Auth logo url', () => {
		expect(
			betterAuthOrganizationToOutput({
				...organization,
				logo: organization.logo,
			}).logoUrl
		).toBe('https://example.com/logo.png')
	})
})
