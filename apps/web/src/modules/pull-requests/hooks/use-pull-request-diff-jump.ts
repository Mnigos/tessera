import type { PullRequestThread, PullRequestThreadSide } from '@repo/contracts'
import { useCallback, useSyncExternalStore } from 'react'

/** A row the reader asked for, which a windowed file may not have rendered yet. */
export type PullRequestDiffJump =
	| {
			kind: 'thread'
			path: string
			threadId: PullRequestThread['id']
	  }
	| {
			kind: 'line'
			path: string
			side: PullRequestThreadSide
			line: number
	  }

const REVEAL_DEADLINE_MS = 2000
const FLASH_MS = 1200

const listeners = new Set<() => void>()
let jump: PullRequestDiffJump | undefined
let revealGeneration = 0

function subscribe(listener: () => void) {
	listeners.add(listener)

	return () => {
		listeners.delete(listener)
	}
}

function getServerSnapshot(): PullRequestDiffJump | undefined {
	return undefined
}

// Kept outside React so only the one windowed file holding the row re-renders.
export function requestPullRequestDiffJump(next?: PullRequestDiffJump) {
	if (jump === next) return

	jump = next

	for (const listener of listeners) listener()
}

/** The row this file is being asked to keep mounted, so scrolling can reach it. */
export function usePullRequestDiffJump(path: string) {
	const getSnapshot = useCallback(
		() => (jump?.path === path ? jump : undefined),
		[path]
	)

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function escapeAttributeValue(value: string) {
	return value.replace(/["\\]/g, String.raw`\$&`)
}

function toJumpSelector(target: PullRequestDiffJump) {
	const section = `[data-file-path="${escapeAttributeValue(target.path)}"]`

	if (target.kind === 'thread')
		return `${section} [data-thread-ids~="${escapeAttributeValue(target.threadId)}"]`

	return `${section} [data-side="${target.side}"][data-line="${target.line}"]`
}

function flash(node: HTMLElement) {
	node.setAttribute('data-flash', '')
	setTimeout(() => node.removeAttribute('data-flash'), FLASH_MS)
}

/**
 * Scrolls a row into view once the file that owns it has rendered it: a windowed
 * file only pins the row after the request above reaches it, and the section it
 * lives in may still be mounting its diff.
 */
export function scrollToPullRequestDiffJump(target: PullRequestDiffJump) {
	requestPullRequestDiffJump(target)

	const selector = toJumpSelector(target)
	const deadline = Date.now() + REVEAL_DEADLINE_MS
	const generation = ++revealGeneration

	function attempt() {
		if (generation !== revealGeneration) return

		const node = document.querySelector<HTMLElement>(selector)

		if (!node) {
			if (Date.now() < deadline) requestAnimationFrame(attempt)

			return
		}

		node.scrollIntoView({ behavior: 'auto', block: 'center' })
		flash(node)
		// A pinned row is absolutely placed until the window catches up with it.
		requestAnimationFrame(() => {
			if (generation === revealGeneration)
				node.scrollIntoView({ behavior: 'auto', block: 'center' })
		})
	}

	requestAnimationFrame(attempt)
}
