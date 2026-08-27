import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullRequestsListControls } from './pull-requests-list-controls'

const FILTERS = {
	state: 'open',
	sort: 'created',
	direction: 'desc',
	cursor: 'page-two',
} as const

describe(PullRequestsListControls.name, () => {
	test('forwards draft and sort changes without retaining a cursor', async () => {
		const onFiltersChange = vi.fn()
		const user = userEvent.setup()
		render(
			<PullRequestsListControls
				filters={FILTERS}
				onFiltersChange={onFiltersChange}
			/>
		)

		await user.click(
			screen.getByRole('combobox', {
				name: 'Filter pull requests by draft state',
			})
		)
		await user.click(screen.getByRole('option', { name: 'Drafts only' }))
		await user.click(
			screen.getByRole('combobox', { name: 'Sort pull requests' })
		)
		await user.click(screen.getByRole('option', { name: 'Recent activity' }))
		await user.click(screen.getByRole('button', { name: 'Sort oldest first' }))

		expect(onFiltersChange).toHaveBeenNthCalledWith(1, { draft: 'only' })
		expect(onFiltersChange).toHaveBeenNthCalledWith(2, { sort: 'activity' })
		expect(onFiltersChange).toHaveBeenNthCalledWith(3, { direction: 'asc' })
		expect(onFiltersChange).not.toHaveBeenCalledWith(
			expect.objectContaining({ cursor: expect.anything() })
		)
	})
})
