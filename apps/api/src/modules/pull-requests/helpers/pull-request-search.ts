/** Postgres's `integer`, which the pull request number is stored as. */
const MAX_PULL_REQUEST_NUMBER = 2_147_483_647

/** A search term that names a pull request outright, hash optional. */
const PULL_REQUEST_NUMBER_QUERY_REGEX = /^#?\d+$/

/**
 * Wraps a search term in wildcards for an `ILIKE`, with the wildcards the term
 * itself contains escaped first. Without that, a query of `%` matches every row
 * and a query of `_` matches by position instead of by content — the caller
 * typed characters, not a pattern.
 *
 * The escape character is the backslash Postgres uses by default, so no
 * `ESCAPE` clause is needed on the comparison.
 */
export function toPullRequestSearchPattern(query: string): string {
	return `%${query.replaceAll(/[\\%_]/g, character => `\\${character}`)}%`
}

/**
 * The pull request number a search term names outright, if it names one. `#12`
 * and `12` both mean the same thing to someone looking for a pull request, and
 * neither would be found by substring alone.
 *
 * Anything past what the column can hold is not a number any row could carry,
 * and asking the database to compare against it would be an error rather than
 * an empty result.
 */
export function toPullRequestNumberQuery(query: string): number | undefined {
	if (!PULL_REQUEST_NUMBER_QUERY_REGEX.test(query)) return undefined

	const number = Number.parseInt(query.replace('#', ''), 10)

	if (number < 1 || number > MAX_PULL_REQUEST_NUMBER) return undefined

	return number
}
