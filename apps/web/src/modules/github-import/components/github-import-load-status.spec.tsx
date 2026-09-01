import { act, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { GitHubImportLoadStatus } from './github-import-load-status'

class ControlledIntersectionObserver implements IntersectionObserver {
	static instances: ControlledIntersectionObserver[] = []

	readonly root = null
	readonly rootMargin: string
	readonly thresholds = [0]
	private readonly targets = new Set<Element>()

	disconnect = vi.fn(() => this.targets.clear())
	takeRecords = vi.fn((): IntersectionObserverEntry[] => [])
	unobserve = vi.fn((target: Element) => this.targets.delete(target))

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) {
		this.rootMargin = options?.rootMargin ?? '0px'
		ControlledIntersectionObserver.instances.push(this)
	}

	observe = vi.fn((target: Element) => {
		this.targets.add(target)
	})

	intersect(isIntersecting: boolean) {
		const target = this.targets.values().next().value

		if (!target) throw new Error('Observed target missing')

		this.callback(
			[{ isIntersecting, target } as IntersectionObserverEntry],
			this
		)
	}
}

const defaultProps: ComponentProps<typeof GitHubImportLoadStatus> = {
	hasLoadMoreError: false,
	hasNextPage: true,
	isFetchingNextPage: false,
	isSearching: false,
	loadedCount: 2,
	onLoadMore: vi.fn(),
	pageCount: 1,
	query: '',
}

function renderStatus(
	overrides: Partial<ComponentProps<typeof GitHubImportLoadStatus>> = {}
) {
	return render(<GitHubImportLoadStatus {...defaultProps} {...overrides} />)
}

describe(GitHubImportLoadStatus.name, () => {
	const originalIntersectionObserver = window.IntersectionObserver

	beforeEach(() => {
		window.IntersectionObserver =
			ControlledIntersectionObserver as unknown as typeof IntersectionObserver
	})

	afterEach(() => {
		window.IntersectionObserver = originalIntersectionObserver
		ControlledIntersectionObserver.instances = []
	})

	test.each([
		[
			{
				hasLoadMoreError: true,
				isSearching: true,
				isFetchingNextPage: true,
				loadedCount: 0,
			},
			'Loading more failed.',
		],
		[
			{ isSearching: true, isFetchingNextPage: true, loadedCount: 0 },
			'Searching...',
		],
		[{ loadedCount: 0 }, 'No matches yet. Scanning more repositories...'],
		[
			{ isFetchingNextPage: true, loadedCount: 1 },
			'1 repository loaded. Loading more...',
		],
		[{ loadedCount: 2 }, '2 repositories loaded. Scroll for more.'],
		[{ hasNextPage: false, loadedCount: 3 }, 'All 3 repositories loaded.'],
	] as const)('renders status precedence for %j', (props, expected) => {
		renderStatus(props)

		expect(screen.getByText(expected)).toBeTruthy()
	})

	test('announces status changes politely', () => {
		renderStatus()

		expect(
			screen
				.getByText('2 repositories loaded. Scroll for more.')
				.getAttribute('aria-live')
		).toBe('polite')
	})

	test('renders Retry only after a load-more error', () => {
		const onLoadMore = vi.fn()
		const rendered = renderStatus({ onLoadMore })

		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

		rendered.rerender(
			<GitHubImportLoadStatus
				{...defaultProps}
				hasLoadMoreError
				onLoadMore={onLoadMore}
			/>
		)
		act(() => screen.getByRole('button', { name: 'Retry' }).click())

		expect(onLoadMore).toHaveBeenCalledOnce()
	})

	test('renders the sentinel only while another page can load without error', () => {
		const rendered = renderStatus({ hasNextPage: false })

		expect(rendered.container.querySelector('[aria-hidden="true"]')).toBeNull()

		rendered.rerender(<GitHubImportLoadStatus {...defaultProps} />)
		expect(
			rendered.container.querySelector('[aria-hidden="true"]')
		).toBeTruthy()

		rendered.rerender(
			<GitHubImportLoadStatus {...defaultProps} hasLoadMoreError />
		)
		expect(rendered.container.querySelector('[aria-hidden="true"]')).toBeNull()
	})

	test('loads on intersection and disconnects on unmount', () => {
		const onLoadMore = vi.fn()
		const rendered = renderStatus({ onLoadMore })
		const observer = ControlledIntersectionObserver.instances[0]
		const sentinel = rendered.container.querySelector('[aria-hidden="true"]')

		expect(observer).toBeTruthy()
		expect(sentinel).toBeTruthy()
		if (!(observer && sentinel)) return
		expect(observer.rootMargin).toBe('200px 0px')
		expect(observer.observe).toHaveBeenCalledWith(sentinel)

		act(() => observer.intersect(false))
		expect(onLoadMore).not.toHaveBeenCalled()
		act(() => observer.intersect(true))
		expect(onLoadMore).toHaveBeenCalledOnce()

		rendered.unmount()
		expect(observer.disconnect).toHaveBeenCalledOnce()
	})

	test.each([
		['pageCount', { pageCount: 2 }],
		['query', { query: 'ludus' }],
	] as const)('re-observes after %s changes', (_, changedProps) => {
		const rendered = renderStatus()
		const firstObserver = ControlledIntersectionObserver.instances[0]

		rendered.rerender(
			<GitHubImportLoadStatus {...defaultProps} {...changedProps} />
		)

		expect(firstObserver?.disconnect).toHaveBeenCalledOnce()
		expect(ControlledIntersectionObserver.instances).toHaveLength(2)
		expect(
			ControlledIntersectionObserver.instances[1]?.observe
		).toHaveBeenCalledOnce()
	})
})
