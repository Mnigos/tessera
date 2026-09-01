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

interface TypedQuery {
	value: string
	against: string
}

function toQuery(value: string): string | undefined {
	const trimmed = value.trim()

	return trimmed ? trimmed : undefined
}

interface SearchInputProps {
	label: string
	maxLength: number
	onQueryChange: (query: string | undefined) => void
	placeholder: string
	query: string
}

// Keystrokes win only until the URL they were typed against moves (debounced nav,
// Back, or another control); the displayed value is derived from the URL, not synced.
export function SearchInput({
	label,
	maxLength,
	onQueryChange,
	placeholder,
	query,
}: Readonly<SearchInputProps>) {
	const inputId = useId()
	const [typed, setTyped] = useState<TypedQuery | undefined>(undefined)
	const debounceTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined
	)
	const currentQuery = useRef(query)
	currentQuery.current = query
	// Equality is judged on the trimmed form, so landing mid-word does not swallow
	// the space between "foo " and the "bar" still being typed.
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
					{label}
				</label>
				<Search
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					autoComplete="off"
					className="px-9"
					id={inputId}
					maxLength={maxLength}
					onChange={handleChange}
					placeholder={placeholder}
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
