import { useCallback, useRef, useState } from 'react'

// Diffs load before the reader arrives, so scrolling never waits on a request.
const PRELOAD_OPTIONS = { rootMargin: '600px 0px' }

// Far outside the preload band, so one scroll cannot both mount and evict a section.
const EVICTION_OPTIONS = { rootMargin: '2500px 0px' }

// A band near the top of the viewport, so one file at a time reads as current.
const ACTIVE_OPTIONS = { rootMargin: '-10% 0px -75% 0px' }

interface SectionObservers {
	preload: IntersectionObserver
	eviction: IntersectionObserver
	active: IntersectionObserver
}

interface MountedSections {
	paths: ReadonlySet<string>
	placeholders: ReadonlyMap<string, number>
}

const NO_MOUNTED_SECTIONS: MountedSections = {
	paths: new Set(),
	placeholders: new Map(),
}

function holdsDraftOrFocus(node: Element): boolean {
	return (
		Boolean(node.querySelector('textarea')) ||
		node.contains(document.activeElement)
	)
}

function mountSections(
	sections: MountedSections,
	entered: readonly string[]
): MountedSections {
	const added = entered.filter(path => !sections.paths.has(path))

	if (added.length === 0) return sections

	const paths = new Set(sections.paths)
	const placeholders = new Map(sections.placeholders)

	for (const path of added) {
		paths.add(path)
		placeholders.delete(path)
	}

	return { paths, placeholders }
}

function evictSections(
	sections: MountedSections,
	evictable: readonly (readonly [string, number])[]
): MountedSections {
	const evicted = evictable.filter(([path]) => sections.paths.has(path))

	if (evicted.length === 0) return sections

	const paths = new Set(sections.paths)
	const placeholders = new Map(sections.placeholders)

	for (const [path, height] of evicted) {
		paths.delete(path)
		placeholders.set(path, height)
	}

	return { paths, placeholders }
}

export function usePullRequestFileSections() {
	const sectionNodes = useRef(new Map<string, HTMLElement>())
	const observedPaths = useRef(new WeakMap<Element, string>())
	const observers = useRef<SectionObservers>(undefined)
	const activePathNow = useRef<string>(undefined)
	const [expansionOverrides, setExpansionOverrides] = useState<
		Record<string, boolean>
	>({})
	const [mounted, setMounted] = useState<MountedSections>(NO_MOUNTED_SECTIONS)
	const [activePath, setActivePath] = useState<string>()

	const toEnteredPaths = useCallback(
		(entries: readonly IntersectionObserverEntry[]) =>
			entries
				.filter(entry => entry.isIntersecting)
				.map(entry => observedPaths.current.get(entry.target))
				.filter(path => path !== undefined),
		[]
	)
	const markActive = useCallback((path: string | undefined) => {
		activePathNow.current = path
		setActivePath(path)
	}, [])
	const getObservers = useCallback((): SectionObservers => {
		observers.current ??= {
			preload: new IntersectionObserver(entries => {
				const entered = toEnteredPaths(entries)

				if (entered.length > 0)
					setMounted(sections => mountSections(sections, entered))
			}, PRELOAD_OPTIONS),
			eviction: new IntersectionObserver(entries => {
				const evictable = entries.flatMap(entry => {
					const path = observedPaths.current.get(entry.target)

					if (entry.isIntersecting || !path) return []
					if (path === activePathNow.current || holdsDraftOrFocus(entry.target))
						return []

					return [[path, entry.boundingClientRect.height] as const]
				})

				if (evictable.length > 0)
					setMounted(sections => evictSections(sections, evictable))
			}, EVICTION_OPTIONS),
			active: new IntersectionObserver(entries => {
				const [entered] = toEnteredPaths(entries)

				if (entered) markActive(entered)
			}, ACTIVE_OPTIONS),
		}

		return observers.current
	}, [markActive, toEnteredPaths])
	const registerSectionNode = useCallback(
		(path: string, node: HTMLElement | null) => {
			const { active, eviction, preload } = getObservers()
			const observed = sectionNodes.current.get(path)

			if (observed) {
				preload.unobserve(observed)
				eviction.unobserve(observed)
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
			eviction.observe(node)
			active.observe(node)
		},
		[getObservers]
	)
	const scrollToSection = useCallback(
		(path: string, behavior: ScrollBehavior) => {
			markActive(path)
			sectionNodes.current
				.get(path)
				?.scrollIntoView({ behavior, block: 'start' })
		},
		[markActive]
	)
	const setExpanded = useCallback((path: string, isExpanded: boolean) => {
		setExpansionOverrides(overrides => ({ ...overrides, [path]: isExpanded }))
	}, [])
	const clearExpanded = useCallback((path: string) => {
		setExpansionOverrides(overrides =>
			Object.fromEntries(
				Object.entries(overrides).filter(([key]) => key !== path)
			)
		)
	}, [])
	// Mounted sections stay mounted, so a comment being written survives the reset.
	const reset = useCallback(() => {
		setExpansionOverrides({})
		markActive(undefined)
		setMounted(sections =>
			sections.placeholders.size === 0
				? sections
				: { paths: sections.paths, placeholders: new Map() }
		)
	}, [markActive])

	return {
		activePath,
		clearExpanded,
		expansionOverrides,
		mountedPaths: mounted.paths,
		registerSectionNode,
		reset,
		scrollToSection,
		sectionPlaceholders: mounted.placeholders,
		setExpanded,
	}
}
