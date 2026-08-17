import { createContext, type ReactNode, useContext, useReducer } from 'react'
import {
	type DiffLineSelection,
	type DiffLineSelectionAction,
	reduceDiffLineSelection,
} from '../helpers/diff-line-selection'

const PullRequestDiffSelectionContext = createContext<{
	selection?: DiffLineSelection
	dispatch: (action: DiffLineSelectionAction) => void
}>({ dispatch: () => undefined })

/** One line selection at a time across every file diff a comparison renders. */
export function PullRequestDiffSelectionProvider({
	children,
}: Readonly<{ children: ReactNode }>) {
	const [selection, dispatch] = useReducer(reduceDiffLineSelection, undefined)

	function dispatchSelection(action: DiffLineSelectionAction) {
		// A drag may be released over any file or none, so the document ends it.
		if (action.type === 'begin')
			window.addEventListener('pointerup', () => dispatch({ type: 'commit' }), {
				once: true,
			})

		dispatch(action)
	}

	return (
		<PullRequestDiffSelectionContext
			value={{ selection, dispatch: dispatchSelection }}
		>
			{children}
		</PullRequestDiffSelectionContext>
	)
}

/** The one selection, which each file keeps only while its own path holds it. */
export function usePullRequestDiffSelection() {
	const { selection, dispatch } = useContext(PullRequestDiffSelectionContext)

	return [selection, dispatch] as const
}
