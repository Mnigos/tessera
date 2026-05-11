import { describe, expect, test } from 'vitest'

import { coerceEnumValue } from './coerce-enum-value'

describe('coerceEnumValue', () => {
	const profileVisibilityValues = ['PUBLIC', 'NON_PUBLIC', 'PRIVATE'] as const

	test('should return the provided value when it is allowed', () => {
		expect(
			coerceEnumValue('PUBLIC', profileVisibilityValues, 'NON_PUBLIC')
		).toBe('PUBLIC')
	})

	test('should return the fallback when the value is undefined', () => {
		expect(
			coerceEnumValue(undefined, profileVisibilityValues, 'NON_PUBLIC')
		).toBe('NON_PUBLIC')
	})

	test('should return the fallback when the value is not allowed', () => {
		expect(
			coerceEnumValue('month', profileVisibilityValues, 'NON_PUBLIC')
		).toBe('NON_PUBLIC')
	})
})
