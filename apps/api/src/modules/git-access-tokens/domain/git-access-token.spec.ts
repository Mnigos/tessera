import { parseRecord } from './git-access-token'

describe(parseRecord.name, () => {
	test('parses string records with string array values', () => {
		expect(parseRecord(JSON.stringify({ git: ['read', 'write'] }))).toEqual({
			git: ['read', 'write'],
		})
	})

	test('returns object records with string array values', () => {
		expect(parseRecord({ git: ['read'] })).toEqual({ git: ['read'] })
	})

	test('rejects invalid record values', () => {
		expect(parseRecord(undefined)).toBeUndefined()
		expect(parseRecord(JSON.stringify({ git: 'read' }))).toBeUndefined()
		expect(parseRecord({ git: [1] })).toBeUndefined()
		expect(parseRecord(['read'])).toBeUndefined()
	})

	test('rejects invalid JSON string records', () => {
		expect(parseRecord('{git')).toBeUndefined()
	})
})
