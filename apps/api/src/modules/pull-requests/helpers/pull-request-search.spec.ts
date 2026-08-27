import {
	toPullRequestNumberQuery,
	toPullRequestSearchPattern,
} from './pull-request-search'

describe('toPullRequestSearchPattern', () => {
	test('matches the term anywhere in the value', () => {
		expect(toPullRequestSearchPattern('login')).toBe('%login%')
	})

	test('escapes the wildcards a typed term contains', () => {
		expect(toPullRequestSearchPattern('100%_off')).toBe('%100\\%\\_off%')
	})

	test('escapes the escape character itself', () => {
		expect(toPullRequestSearchPattern('a\\b')).toBe('%a\\\\b%')
	})
})

describe('toPullRequestNumberQuery', () => {
	test('reads a bare number', () => {
		expect(toPullRequestNumberQuery('42')).toBe(42)
	})

	test('reads a hash-prefixed number', () => {
		expect(toPullRequestNumberQuery('#42')).toBe(42)
	})

	test('is nothing for a term that is not only digits', () => {
		expect(toPullRequestNumberQuery('pr 42')).toBeUndefined()
	})

	test('is nothing for zero, which no pull request carries', () => {
		expect(toPullRequestNumberQuery('0')).toBeUndefined()
	})

	// The column is a 32-bit integer; comparing against more would be an error.
	test('is nothing for a number no column could hold', () => {
		expect(toPullRequestNumberQuery('99999999999')).toBeUndefined()
	})

	test('accepts the largest pull request number PostgreSQL can store', () => {
		expect(toPullRequestNumberQuery('2147483647')).toBe(2_147_483_647)
	})

	test.each([
		'#',
		'-1',
		'+1',
		'1.5',
		' 12 ',
	])('is nothing for the non-number form %s', query => {
		expect(toPullRequestNumberQuery(query)).toBeUndefined()
	})
})
