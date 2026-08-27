import { PULL_REQUESTS_SEARCH_MAX_LENGTH } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { Search, X } from 'lucide-react'
import {
	type ChangeEvent,
	type FormEvent,
	useId,
	useRef,
	useState,
} from 'react'
import { useMountEffect } from '@/shared/hooks/use-mount-effect'

const SEARCH_DEBOUNCE_MS = 300

/** What was typed, and the URL query it was typed against. */
interface TypedQuery {
	value: string
	against: string
}

function toQuery(value: string): string | undefined {
	const trimmed = value.trim()

	return trimmed ? trimmed : undefined
}

interface PullRequestsSearchInputProps {
	query: string
	onQueryChange: (query: string | undefined) => void
}

/**
 * Navigation is debounced so a search does not put one history entry per
 * keystroke on the stack. Keystrokes win only until the URL they were typed
 * against moves; whatever moved it — the debounced navigation itself, Back, or
 * clearing the filters — the URL is the answer from then on, which is why the
 * displayed value is derived rather than synchronized.
 */
export function PullRequestsSearchInput({
	query,
	onQueryChange,
}: Readonly<PullRequestsSearchInputProps>) {
	const inputId = useId()
	const [typed, setTyped] = useState<TypedQuery | undefined>(undefined)
	const debounceTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined
	)
	// What the URL says right now, readable from inside a pending timer. A timer
	// scheduled against an older URL must notice that Back or another control
	// has moved it and let the newer state stand instead of navigating over it.
	const currentQuery = useRef(query)
	currentQuery.current = query
	// The debounced navigation lands with the typed text trimmed, so equality is
	// judged on the trimmed form — otherwise landing mid-word would swallow the
	// space between "foo " and the "bar" still being typed.
	const value =
		typed !== undefined &&
		(typed.against === query || toQuery(typed.value) === toQuery(query))
			? typed.value
			: query

	useMountEffect(() => () => {
		if (debounceTimeout.current) clearTimeout(debounceTimeout.current)
	})

	function navigateNow(nextValue: string) {
		if (debounceTimeout.current) clearTimeout(debounceTimeout.current)

		onQueryChange(toQuery(nextValue))
	}

	function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const nextValue = event.target.value

		setTyped({ value: nextValue, against: query })
		if (debounceTimeout.current) clearTimeout(debounceTimeout.current)
		debounceTimeout.current = setTimeout(() => {
			// The URL moved on since this was typed; the typed text is stale.
			if (currentQuery.current !== query) return

			onQueryChange(toQuery(nextValue))
		}, SEARCH_DEBOUNCE_MS)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		navigateNow(value)
	}

	function handleClear() {
		setTyped({ value: '', against: query })
		navigateNow('')
	}

	return (
		<search className="min-w-0 flex-1">
			{/* Submitting flushes the debounce, so Enter searches at once. */}
			<form className="relative" onSubmit={handleSubmit}>
				<label className="sr-only" htmlFor={inputId}>
					Search pull requests
				</label>
				<Search
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					autoComplete="off"
					className="px-9"
					id={inputId}
					maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
					onChange={handleChange}
					placeholder="Search by number, title, branch, or author"
					spellCheck={false}
					value={value}
				/>
				{value && (
					<Button
						aria-label="Clear search"
						className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						onClick={handleClear}
						size="icon"
						type="button"
						variant="ghost"
					>
						<X aria-hidden />
					</Button>
				)}
			</form>
		</search>
	)
}
