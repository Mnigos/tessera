import {
	type PullRequestSort,
	type PullRequestSortDirection,
	pullRequestSortDirectionSchema,
	pullRequestSortSchema,
} from '@repo/contracts'
import { z } from 'zod'
import { InvalidPullRequestCursorError } from '../domain/pull-request.errors'

/**
 * Where a page left off, as the keyset predicate reads it.
 *
 * The timestamp stays text at Postgres's own microsecond precision rather than
 * becoming a `Date`: JavaScript only keeps milliseconds, and a cursor rounded to
 * the millisecond would either skip rows or serve them twice whenever two pull
 * requests share a sort key to within a thousandth of a second.
 */
export interface PullRequestCursor {
	value: string
	number: number
}

/** The ordering a cursor was issued under, and the only one it is valid for. */
export interface PullRequestCursorOrdering {
	sort: PullRequestSort
	direction: PullRequestSortDirection
}

const TIMESTAMP_SEPARATORS_REGEX = /[-: .]/

/**
 * Whether a shape-valid timestamp names a moment that exists. The shape alone
 * admits `2026-99-99`, which Postgres would refuse at the `::timestamp` cast —
 * as a database error long past the validation boundary, not as the 400 a
 * forged token deserves.
 */
function isRealTimestamp(value: string): boolean {
	const [year, month, day, hour, minute, second] = value
		.split(TIMESTAMP_SEPARATORS_REGEX)
		.map(Number)

	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		hour === undefined ||
		minute === undefined ||
		second === undefined
	)
		return false

	// Date.UTC normalizes an impossible day into the next month, so a round-trip
	// that lands somewhere else is the forgery detector.
	const roundTrip = new Date(Date.UTC(year, month - 1, day))

	return (
		roundTrip.getUTCFullYear() === year &&
		roundTrip.getUTCMonth() === month - 1 &&
		roundTrip.getUTCDate() === day &&
		hour < 24 &&
		minute < 60 &&
		second < 60
	)
}

/** `to_char(sort_column, 'YYYY-MM-DD HH24:MI:SS.US')`, and nothing else. */
const cursorTimestampSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/)
	.refine(isRealTimestamp)

/** Postgres's `integer`, which the pull request number column is stored as. */
const MAX_CURSOR_NUMBER = 2_147_483_647

// Single-letter keys because the payload is base64 in a query string and every
// byte of it is length the client has to carry; nothing outside this file reads
// them.
const cursorPayloadSchema = z.object({
	s: pullRequestSortSchema,
	d: pullRequestSortDirectionSchema,
	v: cursorTimestampSchema,
	// Bounded to what the column can hold: a larger number cannot have been
	// issued by this server, and comparing against it would be a database error
	// rather than an empty page.
	n: z.number().int().positive().max(MAX_CURSOR_NUMBER),
})

/**
 * Packs a keyset position into the opaque token the contract promises. The
 * ordering travels inside it so a token replayed under a different sort can be
 * refused rather than silently paginating through the wrong sequence.
 */
export function encodePullRequestCursor(
	cursor: PullRequestCursor,
	ordering: PullRequestCursorOrdering
): string {
	return Buffer.from(
		JSON.stringify({
			s: ordering.sort,
			d: ordering.direction,
			v: cursor.value,
			n: cursor.number,
		})
	).toString('base64url')
}

/**
 * Reads a token back, refusing anything this server did not issue for this
 * exact ordering. Every failure is the same refusal: the token is opaque, so
 * there is nothing a client could usefully be told apart from to start over.
 */
export function decodePullRequestCursor(
	cursor: string,
	ordering: PullRequestCursorOrdering
): PullRequestCursor {
	const payload = cursorPayloadSchema.safeParse(
		parseCursorJson(cursor, ordering)
	)

	if (!payload.success)
		throw new InvalidPullRequestCursorError({
			reason: 'malformed',
			...ordering,
		})

	if (payload.data.s !== ordering.sort || payload.data.d !== ordering.direction)
		throw new InvalidPullRequestCursorError({
			reason: 'ordering_changed',
			cursorSort: payload.data.s,
			cursorDirection: payload.data.d,
			...ordering,
		})

	return { value: payload.data.v, number: payload.data.n }
}

function parseCursorJson(
	cursor: string,
	ordering: PullRequestCursorOrdering
): unknown {
	try {
		return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
	} catch {
		throw new InvalidPullRequestCursorError({
			reason: 'undecodable',
			...ordering,
		})
	}
}
