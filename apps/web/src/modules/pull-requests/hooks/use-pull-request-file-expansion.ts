import type {
	GetPullRequestFileDiffInput,
	PullRequestFileDiff,
} from '@repo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { orpcQuery } from '@/lib/orpc/query'

type PullRequestDiffLine = PullRequestFileDiff['hunks'][number]['lines'][number]

export interface PullRequestFileExpansionRequest {
	/** Identifies the gap the request came from, so only it shows the outcome. */
	gapKey: string
	startLine: number
	endLine: number
}

export interface PullRequestFileExpansionState {
	/** Revealed context lines by their line number on the right side. */
	lines: ReadonlyMap<number, PullRequestDiffLine>
	totalLines?: number
	pendingGapKey?: string
	failed?: PullRequestFileExpansionRequest
	error?: unknown
}

export interface PullRequestFileExpansion
	extends PullRequestFileExpansionState {
	expand: (request: PullRequestFileExpansionRequest) => void
	retry: () => void
}

const EMPTY_STATE: PullRequestFileExpansionState = { lines: new Map() }

// Revealed lines are immutable at a fixed pair of shas, so they outlive the
// diff's own mount: a section evicted while scrolling comes back expanded.
const states = new Map<string, PullRequestFileExpansionState>()
const listeners = new Map<string, Set<() => void>>()

function toExpansionKey(input: GetPullRequestFileDiffInput) {
	return [
		input.username,
		input.slug,
		input.number,
		input.expectedBaseSha,
		input.expectedHeadSha,
		input.path,
	].join(' ')
}

function getState(key: string) {
	return states.get(key) ?? EMPTY_STATE
}

function setState(key: string, state: PullRequestFileExpansionState) {
	states.set(key, state)

	for (const listener of listeners.get(key) ?? []) listener()
}

function subscribe(key: string, listener: () => void) {
	const registered = listeners.get(key) ?? new Set<() => void>()

	registered.add(listener)
	listeners.set(key, registered)

	return () => {
		registered.delete(listener)
	}
}

/** Lines already held are never asked for again; the shas make them final. */
export function usePullRequestFileExpansion(
	input: GetPullRequestFileDiffInput
): PullRequestFileExpansion {
	const queryClient = useQueryClient()
	const key = toExpansionKey(input)
	const state = useSyncExternalStore(
		useCallback(listener => subscribe(key, listener), [key]),
		useCallback(() => getState(key), [key]),
		() => EMPTY_STATE
	)
	const expand = useCallback(
		async (request: PullRequestFileExpansionRequest) => {
			if (getState(key).pendingGapKey) return

			setState(key, { ...getState(key), pendingGapKey: request.gapKey })

			try {
				const result = await queryClient.fetchQuery(
					orpcQuery.pullRequests.fileLines.queryOptions({
						input: {
							...input,
							side: 'right',
							startLine: request.startLine,
							endLine: request.endLine,
						},
						staleTime: Number.POSITIVE_INFINITY,
					})
				)
				const lines = new Map(getState(key).lines)

				for (const line of result.lines)
					if (line.new) lines.set(line.new.line, line)

				setState(key, { lines, totalLines: result.totalLines })
			} catch (error) {
				setState(key, {
					...getState(key),
					error,
					failed: request,
					pendingGapKey: undefined,
				})
			}
		},
		[input, key, queryClient]
	)

	return {
		...state,
		expand: useCallback(
			(request: PullRequestFileExpansionRequest) => void expand(request),
			[expand]
		),
		retry: useCallback(() => {
			const { failed } = getState(key)

			if (failed) void expand(failed)
		}, [expand, key]),
	}
}
