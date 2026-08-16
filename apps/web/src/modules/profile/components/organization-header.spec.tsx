import type { Organization } from '@repo/contracts'
import type { OrganizationId } from '@repo/domain'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { OrganizationHeader } from './organization-header'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params: { slug: string }
	}) => (
		<a href={`/organizations/${params.slug}/settings`} {...props}>
			{children}
		</a>
	),
}))

const organization: Organization = {
	id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	slug: 'acme',
	name: 'Acme',
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
}

describe(OrganizationHeader.name, () => {
	test('shows the organization identity and settings to a member', () => {
		render(
			<OrganizationHeader organization={organization} viewerRole="member" />
		)

		expect(screen.getByRole('heading', { name: 'Acme' })).toBeTruthy()
		expect(screen.getByText('@acme')).toBeTruthy()
		expect(
			screen.getByText('Settings').closest('a')?.getAttribute('href')
		).toBe('/organizations/acme/settings')
	})

	test('hides settings from viewers without an organization role', () => {
		render(<OrganizationHeader organization={organization} />)

		expect(screen.getByRole('heading', { name: 'Acme' })).toBeTruthy()
		expect(screen.queryByText('Settings')).toBeNull()
	})
})
