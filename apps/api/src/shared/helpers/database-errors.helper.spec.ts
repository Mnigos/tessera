import { isUniqueViolation } from './database-errors.helper'

describe('database error helpers', () => {
	test('matches unique violations by constraint name', () => {
		expect(
			isUniqueViolation(
				{
					code: '23505',
					constraint_name: 'repositories_owner_user_slug_unique',
				},
				new Set(['repositories_owner_user_slug_unique'])
			)
		).toBe(true)
	})

	test('matches wrapped database errors', () => {
		expect(
			isUniqueViolation(
				{
					cause: {
						code: '23505',
						constraint: 'repositories_owner_user_slug_unique',
					},
				},
				new Set(['repositories_owner_user_slug_unique'])
			)
		).toBe(true)
	})

	test('rejects non-matching constraints', () => {
		expect(
			isUniqueViolation(
				{ code: '23505', constraint_name: 'other_unique' },
				new Set(['repositories_owner_user_slug_unique'])
			)
		).toBe(false)
	})
})
