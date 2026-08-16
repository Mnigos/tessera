export const HANDLE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const HANDLE_MAX_LENGTH = 39

// Handles that would shadow a web route, so the /$handle page can never own them.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	'api',
	'import',
	'invitations',
	'login',
	'organizations',
	'profile',
	'settings',
])

const HANDLE_UNSAFE_CHARS_REGEX = /[^a-z0-9-]+/g
const HANDLE_REPEATED_DASH_REGEX = /-+/g
export const HANDLE_EDGE_DASH_REGEX = /^-|-$/g

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
