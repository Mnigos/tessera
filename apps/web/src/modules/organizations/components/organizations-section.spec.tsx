import type { OrganizationId } from '@repo/domain'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useOrganizationsQuery } from '../hooks/use-organizations.query'
import { OrganizationsSection } from './organizations-section'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		to: string
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))
vi.mock('../hooks/use-organizations.query', () => ({
	useOrganizationsQuery: vi.fn(),
}))

const useOrganizationsQueryMock = vi.mocked(useOrganizationsQuery)

describe(OrganizationsSection.name, () => {
	test('shows organizations and the create entry point on the owner profile', () => {
		useOrganizationsQueryMock.mockReturnValue({
			data: {
				organizations: [
					{
						id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
						slug: 'tessera',
						name: 'Tessera',
						role: 'owner',
						createdAt: new Date('2026-08-16T10:00:00.000Z'),
					},
				],
			},
			isLoading: false,
			isError: false,
		} as never)

		render(<OrganizationsSection enabled />)

		expect(
			screen.getByRole('heading', { name: 'Your organizations' })
		).toBeTruthy()
		expect(screen.getByText('Tessera')).toBeTruthy()
		expect(screen.getByText('/tessera · owner')).toBeTruthy()
		expect(
			screen
				.getByRole('button', { name: 'New organization' })
				.getAttribute('href')
		).toBe('/organizations/new')
	})

	test('renders nothing and disables the query on another profile', () => {
		useOrganizationsQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: false,
		} as never)

		const { container } = render(<OrganizationsSection enabled={false} />)

		expect(container.childElementCount).toBe(0)
		expect(useOrganizationsQueryMock).toHaveBeenCalledWith(false)
	})
})
