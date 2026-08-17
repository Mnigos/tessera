import { useRef, useState } from 'react'

// Diffs load before the reader arrives, so scrolling never waits on a request.
const PRELOAD_OPTIONS = { rootMargin: '600px 0px' }

// A band near the top of the viewport, so one file at a time reads as current.
const ACTIVE_OPTIONS = { rootMargin: '-10% 0px -75% 0px' }

interface SectionObservers {
	preload: IntersectionObserver
	active: IntersectionObserver
}

// Two observers serve the whole list rather than two per file.
export function usePullRequestFileSections() {
	const sectionNodes = useRef(new Map<string, HTMLElement>())
	const observedPaths = useRef(new WeakMap<Element, string>())
	const observers = useRef<SectionObservers>(undefined)
	const [expansionOverrides, setExpansionOverrides] = useState<
		Record<string, boolean>
	>({})
	const [nearViewportPaths, setNearViewportPaths] = useState<string[]>([])
	const [activePath, setActivePath] = useState<string>()

	function toEnteredPaths(entries: readonly IntersectionObserverEntry[]) {
		return entries
			.filter(entry => entry.isIntersecting)
			.map(entry => observedPaths.current.get(entry.target))
			.filter(path => path !== undefined)
	}

	function getObservers(): SectionObservers {
		observers.current ??= {
			preload: new IntersectionObserver(entries => {
				const entered = toEnteredPaths(entries)

				setNearViewportPaths(paths => {
					const added = entered.filter(path => !paths.includes(path))

					return added.length > 0 ? [...paths, ...added] : paths
				})
			}, PRELOAD_OPTIONS),
			active: new IntersectionObserver(entries => {
				const [entered] = toEnteredPaths(entries)

				if (entered) setActivePath(entered)
			}, ACTIVE_OPTIONS),
		}

		return observers.current
	}

	function registerSectionNode(path: string, node: HTMLElement | null) {
		const { active, preload } = getObservers()
		const observed = sectionNodes.current.get(path)

		if (observed) {
			preload.unobserve(observed)
			active.unobserve(observed)
			observedPaths.current.delete(observed)
		}

		if (!node) {
			sectionNodes.current.delete(path)

			return
		}

		sectionNodes.current.set(path, node)
		observedPaths.current.set(node, path)
		preload.observe(node)
		active.observe(node)
	}

	function scrollToSection(path: string, behavior: ScrollBehavior) {
		setActivePath(path)
		sectionNodes.current.get(path)?.scrollIntoView({ behavior, block: 'start' })
	}

	function setExpanded(path: string, isExpanded: boolean) {
		setExpansionOverrides(overrides => ({ ...overrides, [path]: isExpanded }))
	}

	function clearExpanded(path: string) {
		setExpansionOverrides(overrides =>
			Object.fromEntries(
				Object.entries(overrides).filter(([key]) => key !== path)
			)
		)
	}

	// Mounted sections stay mounted, so a comment being written survives the reset.
	function reset() {
		setExpansionOverrides({})
		setActivePath(undefined)
	}

	return {
		activePath,
		clearExpanded,
		expansionOverrides,
		nearViewportPaths,
		registerSectionNode,
		reset,
		scrollToSection,
		setExpanded,
	}
}
