import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useSyncExternalStore,
} from 'react'
import {
	type DiffLineSelection,
	type DiffLineSelectionAction,
	reduceDiffLineSelection,
} from '../helpers/diff-line-selection'

/** The paths one file diff answers to; a rename holds a range under either. */
export interface DiffSelectionFile {
	oldPath: string
	newPath: string
}

interface DiffLineSelectionStore {
	dispatch: (action: DiffLineSelectionAction) => void
	getSelection: () => DiffLineSelection | undefined
	subscribe: (listener: () => void) => () => void
}

const NO_SELECTION_STORE: DiffLineSelectionStore = {
	dispatch: () => undefined,
	getSelection: () => undefined,
	subscribe: () => () => undefined,
}

function createDiffLineSelectionStore(): DiffLineSelectionStore {
	const listeners = new Set<() => void>()
	let selection: DiffLineSelection | undefined

	function dispatch(action: DiffLineSelectionAction) {
		// A drag may be released over any file or none, so the document ends it.
		if (action.type === 'begin')
			window.addEventListener('pointerup', () => dispatch({ type: 'commit' }), {
				once: true,
			})

		const next = reduceDiffLineSelection(selection, action)

		if (next === selection) return

		selection = next

		for (const listener of listeners) listener()
	}

	return {
		dispatch,
		getSelection: () => selection,
		subscribe: listener => {
			listeners.add(listener)

			return () => {
				listeners.delete(listener)
			}
		},
	}
}

const PullRequestDiffSelectionContext =
	createContext<DiffLineSelectionStore>(NO_SELECTION_STORE)

// Kept outside React state so a click re-renders the one file holding it, not every diff.
export function PullRequestDiffSelectionProvider({
	children,
}: Readonly<{ children: ReactNode }>) {
	const store = useRef<DiffLineSelectionStore>(undefined)

	store.current ??= createDiffLineSelectionStore()

	return (
		<PullRequestDiffSelectionContext value={store.current}>
			{children}
		</PullRequestDiffSelectionContext>
	)
}

/** The one selection, which each file keeps only while its own path holds it. */
export function usePullRequestDiffSelection(file?: DiffSelectionFile) {
	const store = useContext(PullRequestDiffSelectionContext)
	const oldPath = file?.oldPath
	const newPath = file?.newPath
	const getSnapshot = useCallback(() => {
		const selection = store.getSelection()

		if (!selection) return undefined

		return selection.path === oldPath || selection.path === newPath
			? selection
			: undefined
	}, [newPath, oldPath, store])
	const selection = useSyncExternalStore(
		store.subscribe,
		getSnapshot,
		getSnapshot
	)

	return [selection, store.dispatch] as const
}
