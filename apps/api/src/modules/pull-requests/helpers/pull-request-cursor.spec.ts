import { InvalidPullRequestCursorError } from '../domain/pull-request.errors'
import {
	decodePullRequestCursor,
	encodePullRequestCursor,
	type PullRequestCursorOrdering,
} from './pull-request-cursor'

const ordering: PullRequestCursorOrdering = {
	sort: 'created',
	direction: 'desc',
}
const cursor = { value: '2026-08-27 11:22:33.123456', number: 42 }
const URL_SAFE_REGEX = /^[\w-]+$/

function encodePayload(payload: unknown) {
	return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

describe('pull request cursor', () => {
	test('round-trips a keyset position under its own ordering', () => {
		expect(
			decodePullRequestCursor(
				encodePullRequestCursor(cursor, ordering),
				ordering
			)
		).toEqual(cursor)
	})

	test('encodes to a url-safe token', () => {
		expect(encodePullRequestCursor(cursor, ordering)).toMatch(URL_SAFE_REGEX)
	})

	// The microseconds are the whole point of keeping the value as text.
	test('keeps the sort key at full precision', () => {
		expect(
			decodePullRequestCursor(
				encodePullRequestCursor(
					{ value: '2026-08-27 11:22:33.000001', number: 1 },
					{ sort: 'activity', direction: 'asc' }
				),
				{ sort: 'activity', direction: 'asc' }
			).value
		).toBe('2026-08-27 11:22:33.000001')
	})

	test('refuses a cursor issued under a different sort', () => {
		expect(() =>
			decodePullRequestCursor(
				encodePullRequestCursor(cursor, { sort: 'updated', direction: 'desc' }),
				ordering
			)
		).toThrow(InvalidPullRequestCursorError)
	})

	test('refuses a cursor issued under a different direction', () => {
		expect(() =>
			decodePullRequestCursor(
				encodePullRequestCursor(cursor, { sort: 'created', direction: 'asc' }),
				ordering
			)
		).toThrow(InvalidPullRequestCursorError)
	})

	test('refuses a token that is not base64-encoded json', () => {
		expect(() => decodePullRequestCursor('not-a-cursor', ordering)).toThrow(
			InvalidPullRequestCursorError
		)
	})

	test('refuses a payload that is not an object', () => {
		expect(() =>
			decodePullRequestCursor(encodePayload(['created', 'desc']), ordering)
		).toThrow(InvalidPullRequestCursorError)
	})

	// A millisecond-precision timestamp is exactly what a hand-built cursor made
	// from a JavaScript date would carry, and it is the one that duplicates rows.
	test('refuses a sort key that is not full-precision', () => {
		expect(() =>
			decodePullRequestCursor(
				encodePayload({
					s: 'created',
					d: 'desc',
					v: '2026-08-27 11:22:33.123',
					n: 42,
				}),
				ordering
			)
		).toThrow(InvalidPullRequestCursorError)
	})

	test('refuses a timestamp whose calendar value is invalid', () => {
		expect(() =>
			decodePullRequestCursor(
				encodePayload({
					s: 'created',
					d: 'desc',
					v: '2026-99-99 25:61:61.123456',
					n: 42,
				}),
				ordering
			)
		).toThrow(InvalidPullRequestCursorError)
	})

	test('refuses a tie-breaker that is not a pull request number', () => {
		expect(() =>
			decodePullRequestCursor(
				encodePayload({
					...cursor,
					s: 'created',
					d: 'desc',
					v: cursor.value,
					n: 0,
				}),
				ordering
			)
		).toThrow(InvalidPullRequestCursorError)
	})

	test('reports the refused ordering without echoing the token', () => {
		expect(() => decodePullRequestCursor('%%%', ordering)).toThrow(
			expect.objectContaining({
				context: expect.objectContaining({
					sort: 'created',
					direction: 'desc',
				}),
			})
		)
	})
})
