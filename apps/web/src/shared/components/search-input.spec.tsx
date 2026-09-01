import { PULL_REQUESTS_SEARCH_MAX_LENGTH } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { SearchInput } from './search-input'

const LABEL = 'Search pull requests'
const PLACEHOLDER = 'Search by number, title, branch, or author'

describe(SearchInput.name, () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test('flushes a pending debounced search on Enter', () => {
		vi.useFakeTimers()
		const onQueryChange = vi.fn()
		render(
			<SearchInput
				label={LABEL}
				maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
				onQueryChange={onQueryChange}
				placeholder={PLACEHOLDER}
				query=""
			/>
		)
		const input = screen.getByRole('textbox', { name: LABEL })

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
			<SearchInput
				label={LABEL}
				maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
				onQueryChange={onQueryChange}
				placeholder={PLACEHOLDER}
				query="review"
			/>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

		expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('')
		expect(onQueryChange).toHaveBeenCalledWith(undefined)
	})

	test('keeps trailing typed text when trimmed debounced navigation lands', () => {
		vi.useFakeTimers()
		const onQueryChange = vi.fn()
		const { rerender } = render(
			<SearchInput
				label={LABEL}
				maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
				onQueryChange={onQueryChange}
				placeholder={PLACEHOLDER}
				query=""
			/>
		)
		const input = screen.getByRole('textbox', { name: LABEL })

		fireEvent.change(input, { target: { value: 'review ' } })
		vi.advanceTimersByTime(300)
		expect(onQueryChange).toHaveBeenCalledWith('review')

		rerender(
			<SearchInput
				label={LABEL}
				maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
				onQueryChange={onQueryChange}
				placeholder={PLACEHOLDER}
				query="review"
			/>
		)
		expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('review ')
	})
})
