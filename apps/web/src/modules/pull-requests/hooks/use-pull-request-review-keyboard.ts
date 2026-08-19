import type {
	PullRequestChangedFile,
	PullRequestThread,
	PullRequestThreadSide,
} from '@repo/contracts'
import { useMemo, useRef } from 'react'
import { useMountEffect } from '@/shared/hooks/use-mount-effect'
import { getChangedFilePath } from '../helpers/pull-request-changed-files'
import type { PullRequestDiffJump } from './use-pull-request-diff-jump'
import {
	setPullRequestDiffView,
	setPullRequestDiffWrap,
	usePullRequestDiffViewOptions,
} from './use-pull-request-diff-view-options'

/** The three things a reader can summon from anywhere in the diff. */
export type PullRequestReviewOverlay = 'find' | 'help' | 'jump'

export interface PullRequestReviewKeyboardOptions {
	/** In comparison order, which is the order every shortcut walks. */
	files: readonly PullRequestChangedFile[]
	threads: readonly PullRequestThread[]
	activePath?: string
	changedSincePaths: ReadonlySet<string>
	canMarkViewed: boolean
	isFileViewed: (path: string) => boolean
	isFileExpanded: (path: string) => boolean
	onJumpToFile: (path: string) => void
	onRevealJump: (jump: PullRequestDiffJump) => void
	onToggleViewed: (path: string, isViewed: boolean) => void
	onToggleExpanded: (path: string, isExpanded: boolean) => void
	onOpenOverlay: (overlay: PullRequestReviewOverlay) => void
}

interface UnresolvedThreadStop {
	id: PullRequestThread['id']
	path: string
	line: number
}

const TYPING_TAG_NAMES = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

const OVERLAY_CHORDS: Record<string, PullRequestReviewOverlay | undefined> = {
	f: 'find',
	k: 'jump',
}

const CURSOR_SIDES = [
	'right',
	'left',
] as const satisfies readonly PullRequestThreadSide[]

/** The gutter carrying the line cursor, held outside React so no row re-renders. */
let cursorNode: HTMLElement | undefined

function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false

	return target.isContentEditable || TYPING_TAG_NAMES.has(target.tagName)
}

// A closing popup lingers in the DOM through its exit transition, and answers to nothing.
function isDialogOpen() {
	return Boolean(
		document.querySelector('[data-slot="dialog-content"][data-open]')
	)
}

function getSection(path: string | undefined) {
	if (!path) return undefined

	for (const node of document.querySelectorAll<HTMLElement>('[data-file-path]'))
		if (node.dataset.filePath === path) return node

	return undefined
}

function getCursorGutters(section: HTMLElement, side: PullRequestThreadSide) {
	return [
		...section.querySelectorAll<HTMLElement>(
			`[data-side="${side}"][data-line]`
		),
	]
}

function step<T>(candidates: readonly T[], index: number, delta: number) {
	if (index < 0) return delta > 0 ? candidates[0] : candidates.at(-1)

	return candidates[Math.min(Math.max(index + delta, 0), candidates.length - 1)]
}

function paintCursor(node: HTMLElement) {
	if (cursorNode === node) return

	cursorNode?.removeAttribute('data-cursor')
	cursorNode?.removeAttribute('tabindex')
	cursorNode = node
	node.setAttribute('data-cursor', '')
	node.setAttribute('tabindex', '-1')
	// Real focus, so the line is announced and a windowed row pins itself.
	node.focus({ preventScroll: true })
	node.scrollIntoView({ behavior: 'auto', block: 'nearest' })
}

/** Ordered as the page reads: comparison file order, then line. */
export function toUnresolvedThreadStops(
	files: readonly PullRequestChangedFile[],
	threads: readonly PullRequestThread[]
): UnresolvedThreadStop[] {
	const order = new Map(
		files.map((file, index) => [getChangedFilePath(file), index])
	)

	return threads
		.flatMap(thread => {
			const anchor = thread.currentAnchor

			if (thread.resolved || !anchor) return []

			return [{ id: thread.id, path: anchor.path, line: anchor.endLine }]
		})
		.sort(
			(a, b) =>
				(order.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
					(order.get(b.path) ?? Number.MAX_SAFE_INTEGER) || a.line - b.line
		)
}

/**
 * Every review shortcut, on one window listener the files view owns. Keys are
 * ignored while the caret is in a field or a dialog is up, so the composer and
 * the overlays keep their own keyboard.
 */
export function usePullRequestReviewKeyboard(
	options: Readonly<PullRequestReviewKeyboardOptions>
) {
	const { isWrapped, view } = usePullRequestDiffViewOptions()
	const threadIndex = useRef(-1)
	const paths = useMemo(
		() => options.files.map(file => getChangedFilePath(file)),
		[options.files]
	)
	const threadStops = useMemo(
		() => toUnresolvedThreadStops(options.files, options.threads),
		[options.files, options.threads]
	)
	const activePath = options.activePath ?? paths[0]

	function stepFile(candidates: readonly string[], delta: number) {
		const next = step(
			candidates,
			activePath ? candidates.indexOf(activePath) : -1,
			delta
		)

		if (next && next !== activePath) options.onJumpToFile(next)
	}

	function moveCursor(delta: number) {
		const section = getSection(activePath)

		if (!section) return

		const held =
			cursorNode && section.contains(cursorNode)
				? (cursorNode.dataset.side as PullRequestThreadSide)
				: undefined
		const sides = held
			? [held, ...CURSOR_SIDES.filter(side => side !== held)]
			: CURSOR_SIDES
		const gutters = sides
			.map(side => getCursorGutters(section, side))
			.find(candidates => candidates.length > 0)

		if (!gutters) return

		const next = step(
			gutters,
			cursorNode ? gutters.indexOf(cursorNode) : -1,
			delta
		)

		if (next) paintCursor(next)
	}

	function moveCursorSide(side: PullRequestThreadSide) {
		const section = getSection(activePath)

		if (!section || view === 'unified') return

		const line = cursorNode?.dataset.line
		const gutters = getCursorGutters(section, side)
		const next = line
			? gutters.find(gutter => gutter.dataset.line === line)
			: gutters[0]

		if (next) paintCursor(next)
	}

	function moveThread(delta: number) {
		if (threadStops.length === 0) return

		const count = threadStops.length
		const start = delta > 0 ? 0 : count - 1
		const index =
			threadIndex.current < 0
				? start
				: (threadIndex.current + delta + count) % count
		const stop = threadStops[index] ?? threadStops[0]

		if (!stop) return

		threadIndex.current = index
		options.onRevealJump({ kind: 'thread', path: stop.path, threadId: stop.id })
	}

	function commentOnCursor() {
		const section = getSection(activePath)

		if (!section) return
		if (!(cursorNode && section.contains(cursorNode))) moveCursor(1)

		cursorNode?.querySelector('button')?.click()
	}

	function stepChangedFile(delta: number) {
		const changed = paths.filter(path => options.changedSincePaths.has(path))

		stepFile(changed.length > 0 ? changed : paths, delta)
	}

	const actions: Record<string, () => void> = {
		'/': () => options.onOpenOverlay('find'),
		'?': () => options.onOpenOverlay('help'),
		']': () => stepChangedFile(1),
		'[': () => stepChangedFile(-1),
		ArrowDown: () => moveCursor(1),
		ArrowLeft: () => moveCursorSide('left'),
		ArrowRight: () => moveCursorSide('right'),
		ArrowUp: () => moveCursor(-1),
		J: () => moveCursor(1),
		K: () => moveCursor(-1),
		c: commentOnCursor,
		j: () => stepFile(paths, 1),
		k: () => stepFile(paths, -1),
		n: () => moveThread(1),
		p: () => moveThread(-1),
		u: () => setPullRequestDiffView(view === 'split' ? 'unified' : 'split'),
		v: () => {
			if (activePath && options.canMarkViewed)
				options.onToggleViewed(activePath, !options.isFileViewed(activePath))
		},
		w: () => setPullRequestDiffWrap(!isWrapped),
		x: () => {
			if (activePath)
				options.onToggleExpanded(
					activePath,
					!options.isFileExpanded(activePath)
				)
		},
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented) return

		const isTyping = isTypingTarget(event.target)

		if (event.metaKey || event.ctrlKey) {
			const overlay = OVERLAY_CHORDS[event.key]

			// Browser find reads only the rows a windowed diff happens to have mounted.
			if (overlay && !(isTyping || event.altKey)) {
				event.preventDefault()
				options.onOpenOverlay(overlay)
			}

			return
		}

		if (event.altKey || isTyping || isDialogOpen()) return

		const action = actions[event.key]

		if (!action) return

		event.preventDefault()
		action()
	}

	// One listener outlives every render, so it reads the newest handler, not a stale closure.
	const handlerRef = useRef(handleKeyDown)

	handlerRef.current = handleKeyDown

	useMountEffect(() => {
		const listener = (event: KeyboardEvent) => handlerRef.current(event)

		window.addEventListener('keydown', listener)

		return () => {
			window.removeEventListener('keydown', listener)
			cursorNode = undefined
		}
	})
}
