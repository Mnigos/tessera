/**
 * Users and organizations draw their handles from one namespace — `/{handle}`
 * resolves to either — so the format is defined once here and imported by
 * everything that mints, validates, or displays one. The shape mirrors GitHub's
 * login rules, which is where most handles arrive from.
 */
export const HANDLE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const HANDLE_MAX_LENGTH = 39

const HANDLE_UNSAFE_CHARS_REGEX = /[^a-z0-9-]+/g
const HANDLE_REPEATED_DASH_REGEX = /-+/g
/** Exported so handle-building code can re-trim after its own slicing. */
export const HANDLE_EDGE_DASH_REGEX = /^-|-$/g

/**
 * Coerces arbitrary text into the handle grammar.
 *
 * Unsafe characters collapse to dashes, repeated dashes collapse to one, and
 * the result is trimmed to the length limit. Text with nothing usable in it
 * returns an empty string; callers that need a handle regardless supply their
 * own fallback.
 */
export function toHandle(value: string | null | undefined) {
	return (
		value
			?.trim()
			.toLowerCase()
			.replace(HANDLE_UNSAFE_CHARS_REGEX, '-')
			.replace(HANDLE_REPEATED_DASH_REGEX, '-')
			.replace(HANDLE_EDGE_DASH_REGEX, '')
			.slice(0, HANDLE_MAX_LENGTH)
			.replace(HANDLE_EDGE_DASH_REGEX, '') ?? ''
	)
}
