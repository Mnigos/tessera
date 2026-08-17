import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { PullRequestNavigation } from './pull-request-navigation'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params: { number: string }
		to: string
	}) => (
		<a data-route-number={params.number} href={to} {...props}>
			{children}
		</a>
	),
}))

describe(PullRequestNavigation.name, () => {
	test('renders the files count while every link keeps the local number', () => {
		render(
			<PullRequestNavigation
				changedFilesCount={3}
				number="42"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		const filesLink = screen.getByRole('link', { name: 'Files changed 3' })

		expect(filesLink.getAttribute('aria-current')).toBe('page')
		expect(filesLink.getAttribute('data-route-number')).toBe('42')
		expect(
			screen
				.getAllByRole('link')
				.every(link => link.getAttribute('data-route-number') === '42')
		).toBeTruthy()
	})
})
