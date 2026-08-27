import { fireEvent, render, screen } from '@testing-library/react'
import { PullRequestsSearchInput } from './pull-requests-search-input'

describe(PullRequestsSearchInput.name, () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test('flushes a pending debounced search on Enter', () => {
		vi.useFakeTimers()
		const onQueryChange = vi.fn()
		render(<PullRequestsSearchInput onQueryChange={onQueryChange} query="" />)
		const input = screen.getByRole('textbox', { name: 'Search pull requests' })

		fireEvent.change(input, { target: { value: '  review  ' } })
		fireEvent.submit(input.closest('form') ?? input)

		expect(onQueryChange).toHaveBeenCalledOnce()
		expect(onQueryChange).toHaveBeenCalledWith('review')
		vi.advanceTimersByTime(300)
		expect(onQueryChange).toHaveBeenCalledOnce()
	})

	test('clears the displayed and navigated query immediately', () => {
		const onQueryChange = vi.fn()
		render(
			<PullRequestsSearchInput onQueryChange={onQueryChange} query="review" />
		)

		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

		expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('')
		expect(onQueryChange).toHaveBeenCalledWith(undefined)
	})

	test('keeps trailing typed text when trimmed debounced navigation lands', () => {
		vi.useFakeTimers()
		const onQueryChange = vi.fn()
		const { rerender } = render(
			<PullRequestsSearchInput onQueryChange={onQueryChange} query="" />
		)
		const input = screen.getByRole('textbox', { name: 'Search pull requests' })

		fireEvent.change(input, { target: { value: 'review ' } })
		vi.advanceTimersByTime(300)
		expect(onQueryChange).toHaveBeenCalledWith('review')

		rerender(
			<PullRequestsSearchInput onQueryChange={onQueryChange} query="review" />
		)
		expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('review ')
	})
})
