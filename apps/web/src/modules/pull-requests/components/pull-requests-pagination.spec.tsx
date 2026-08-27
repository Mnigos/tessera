import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullRequestsPagination } from './pull-requests-pagination'

describe(PullRequestsPagination.name, () => {
	test('renders nothing when there is no page in either direction', () => {
		render(<PullRequestsPagination onPageChange={vi.fn()} />)

		expect(
			screen.queryByRole('navigation', { name: 'Pull request pages' })
		).toBeNull()
	})

	test('disables unavailable and busy navigation', () => {
		const { rerender } = render(
			<PullRequestsPagination
				busy
				nextCursor="next-page"
				onPageChange={vi.fn()}
			/>
		)

		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'First page' })
				.disabled
		).toBe(true)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' })
				.disabled
		).toBe(true)

		rerender(
			<PullRequestsPagination cursor="current-page" onPageChange={vi.fn()} />
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'First page' })
				.disabled
		).toBe(false)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' })
				.disabled
		).toBe(true)
	})

	test('keeps first-page navigation available while a page is busy', () => {
		render(
			<PullRequestsPagination
				busy
				cursor="current-page"
				nextCursor="next-page"
				onPageChange={vi.fn()}
			/>
		)

		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'First page' })
				.disabled
		).toBe(false)
	})

	test('navigates to the first and next cursors', async () => {
		const onPageChange = vi.fn()
		const user = userEvent.setup()
		render(
			<PullRequestsPagination
				cursor="current-page"
				nextCursor="next-page"
				onPageChange={onPageChange}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'First page' }))
		await user.click(screen.getByRole('button', { name: 'Next page' }))

		expect(onPageChange).toHaveBeenNthCalledWith(1, undefined)
		expect(onPageChange).toHaveBeenNthCalledWith(2, 'next-page')
	})
})
