import { useSyncExternalStore } from 'react'

export type PullRequestDiffView = 'split' | 'unified'

export interface PullRequestDiffViewOptions {
	view: PullRequestDiffView
	/** Off by default: a wrapped line hides how long it really is. */
	isWrapped: boolean
}

const VIEW_STORAGE_KEY = 'detent.pull-request-diff.view'
const WRAP_STORAGE_KEY = 'detent.pull-request-diff.wrap'

const DEFAULT_OPTIONS: PullRequestDiffViewOptions = {
	view: 'split',
	isWrapped: false,
}

const listeners = new Set<() => void>()
let snapshot: PullRequestDiffViewOptions | undefined

function readStored(key: string) {
	try {
		return window.localStorage.getItem(key)
	} catch {
		return null
	}
}

function writeStored(key: string, value: string) {
	try {
		window.localStorage.setItem(key, value)
	} catch {
		// A browser that refuses storage still gets the session's choice.
	}
}

function getSnapshot(): PullRequestDiffViewOptions {
	snapshot ??= {
		view: readStored(VIEW_STORAGE_KEY) === 'unified' ? 'unified' : 'split',
		isWrapped: readStored(WRAP_STORAGE_KEY) === 'true',
	}

	return snapshot
}

function getServerSnapshot(): PullRequestDiffViewOptions {
	return DEFAULT_OPTIONS
}

function subscribe(listener: () => void) {
	listeners.add(listener)

	return () => {
		listeners.delete(listener)
	}
}

function commit(options: PullRequestDiffViewOptions) {
	snapshot = options

	for (const listener of listeners) listener()
}

export function setPullRequestDiffView(view: PullRequestDiffView) {
	writeStored(VIEW_STORAGE_KEY, view)
	commit({ ...getSnapshot(), view })
}

export function setPullRequestDiffWrap(isWrapped: boolean) {
	writeStored(WRAP_STORAGE_KEY, String(isWrapped))
	commit({ ...getSnapshot(), isWrapped })
}

/** How every diff on the page is laid out, which outlives the route it was set on. */
export function usePullRequestDiffViewOptions(): PullRequestDiffViewOptions {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
