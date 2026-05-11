import { describe, expect, test } from 'vitest'

import { formatAmount, formatDuration, formatPlays } from './formatters'

describe('formatters', () => {
	const zeroDuration = 0
	const oneHour = 3_600_000
	const oneHourThirtyMinutes = 5_400_000
	const twoHoursFifteenMinutes = 8_100_000
	const thirtyMinutes = 1_800_000
	const fortyFiveMinutes = 2_700_000

	const zeroPlays = 0
	const onePlay = 1
	const twoPlays = 2
	const thousandPlays = 1000
	const millionPlays = 1_000_000

	describe('formatAmount', () => {
		test('should return empty string for zero values', () => {
			expect(formatAmount(0, 'plays')).toBe('')
			expect(formatAmount(0, 'playtime')).toBe('')
		})

		test('should format plays correctly', () => {
			expect(formatAmount(onePlay, 'plays')).toBe('1 play')
			expect(formatAmount(twoPlays, 'plays')).toBe('2 plays')
			expect(formatAmount(thousandPlays, 'plays')).toBe('1,000 plays')
		})

		test('should format plays without unit when specified', () => {
			expect(formatAmount(onePlay, 'plays', false)).toBe('1')
			expect(formatAmount(twoPlays, 'plays', false)).toBe('2')
		})

		test('should format playtime correctly', () => {
			expect(formatAmount(oneHour, 'playtime')).toBe('1h')
			expect(formatAmount(oneHourThirtyMinutes, 'playtime')).toBe('1h 30m')
			expect(formatAmount(twoHoursFifteenMinutes, 'playtime')).toBe('2h 15m')
			expect(formatAmount(thirtyMinutes, 'playtime')).toBe('30m')
		})
	})

	describe('formatDuration', () => {
		test('should return empty string for zero duration', () => {
			expect(formatDuration(zeroDuration)).toBe('')
		})

		test('should format hours only when minutes are zero', () => {
			expect(formatDuration(oneHour)).toBe('1h')
		})

		test('should format minutes only when hours are zero', () => {
			expect(formatDuration(thirtyMinutes)).toBe('30m')
			expect(formatDuration(fortyFiveMinutes)).toBe('45m')
		})

		test('should format both hours and minutes when both are non-zero', () => {
			expect(formatDuration(oneHourThirtyMinutes)).toBe('1h 30m')
			expect(formatDuration(twoHoursFifteenMinutes)).toBe('2h 15m')
		})

		test('should format large durations correctly', () => {
			const largeDuration = 10 * oneHour + 45 * 60 * 1000

			expect(formatDuration(largeDuration)).toBe('10h 45m')
		})
	})

	describe('formatPlays', () => {
		test('should return empty string for zero plays', () => {
			expect(formatPlays(zeroPlays)).toBe('')
		})

		test('should format plays with correct unit form (singular/plural)', () => {
			expect(formatPlays(onePlay)).toBe('1 play')
			expect(formatPlays(twoPlays)).toBe('2 plays')
		})

		test('should format plays without unit when specified', () => {
			expect(formatPlays(onePlay, false)).toBe('1')
			expect(formatPlays(twoPlays, false)).toBe('2')
		})

		test('should format large numbers with commas', () => {
			expect(formatPlays(thousandPlays)).toBe('1,000 plays')
			expect(formatPlays(millionPlays)).toBe('1,000,000 plays')
		})
	})
})
