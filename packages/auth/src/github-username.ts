const USERNAME_FALLBACK_BASE = 'user'
const USERNAME_MAX_LENGTH = 39
const USERNAME_SUFFIX_LENGTH = 6
const USERNAME_COLLISION_MAX_ATTEMPTS = 100
const USERNAME_UNSAFE_CHARS_REGEX = /[^a-z0-9-]+/g
const USERNAME_REPEATED_DASH_REGEX = /-+/g
const USERNAME_EDGE_DASH_REGEX = /^-|-$/g

/**
 * Converts a provider username into Tessera's stable, URL-safe namespace format.
 *
 * Unsafe URL characters collapse to dashes, repeated dashes collapse to one dash,
 * and empty values fall back to a deterministic base username.
 */
export function normalizeUsername(value: string | null | undefined) {
	const normalized = value
		?.trim()
		.toLowerCase()
		.replace(USERNAME_UNSAFE_CHARS_REGEX, '-')
		.replace(USERNAME_REPEATED_DASH_REGEX, '-')
		.replace(USERNAME_EDGE_DASH_REGEX, '')
		.slice(0, USERNAME_MAX_LENGTH)
		.replace(USERNAME_EDGE_DASH_REGEX, '')

	return normalized || USERNAME_FALLBACK_BASE
}

/**
 * Builds a short deterministic suffix from a stable provider identifier.
 *
 * The suffix is not cryptographic; it only gives username collisions a compact,
 * repeatable fallback.
 */
export function createUsernameSuffix(value: string | number) {
	let hash = 0
	for (const character of String(value)) {
		hash = (hash * 31 + character.charCodeAt(0)) % 2_176_782_336
	}

	return hash
		.toString(36)
		.padStart(USERNAME_SUFFIX_LENGTH, '0')
		.slice(0, USERNAME_SUFFIX_LENGTH)
}

/**
 * Appends a suffix while keeping the final username within Tessera's length limit.
 *
 * The base is normalized before trimming so callers can pass raw provider values
 * safely.
 */
export function createSuffixedUsername(base: string, suffix: string) {
	const normalizedBase = normalizeUsername(base)
	const trimmedBase = normalizedBase
		.slice(0, USERNAME_MAX_LENGTH - suffix.length - 1)
		.replace(USERNAME_EDGE_DASH_REGEX, '')

	return `${trimmedBase || USERNAME_FALLBACK_BASE}-${suffix}`
}

export interface GitHubUsernameProfile {
	id: string | number
	login?: string | null
}

export type IsUsernameTaken = (username: string) => Promise<boolean>

/**
 * Resolves the first available Tessera username for a GitHub profile.
 *
 * GitHub `login` is preferred over the stable provider account id. The id is
 * only used to produce deterministic collision suffixes.
 */
export async function resolveGitHubUsername(
	profile: GitHubUsernameProfile,
	isUsernameTaken: IsUsernameTaken
) {
	const baseUsername = normalizeUsername(profile.login)
	if (!(await isUsernameTaken(baseUsername))) return baseUsername

	const suffix = createUsernameSuffix(profile.id)
	const suffixedUsername = createSuffixedUsername(baseUsername, suffix)
	if (!(await isUsernameTaken(suffixedUsername))) return suffixedUsername

	let counter = 2
	while (counter <= USERNAME_COLLISION_MAX_ATTEMPTS) {
		const candidate = createSuffixedUsername(
			baseUsername,
			`${suffix}-${String(counter).padStart(2, '0')}`
		)
		if (!(await isUsernameTaken(candidate))) return candidate
		counter += 1
	}

	throw new Error(`Failed to resolve a unique username for ${baseUsername}`)
}

export type UserUpdateData = Record<string, unknown>

/**
 * Removes provider username updates so an existing Tessera username is preserved.
 *
 * Better Auth may remap provider profile data on later sign-ins; this helper
 * keeps Tessera's username stable once it has been assigned.
 */
export function preserveExistingUsernameOnUpdate<TData extends UserUpdateData>(
	userUpdateData: TData
) {
	if (!('username' in userUpdateData)) return userUpdateData

	return {
		...userUpdateData,
		username: undefined,
	}
}
