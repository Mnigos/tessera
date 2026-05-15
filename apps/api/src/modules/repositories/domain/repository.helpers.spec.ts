import type { RepositoryName, RepositorySlug } from '@repo/domain'
import {
	InvalidRepositoryNameError,
	InvalidRepositorySlugError,
} from './repository.errors'
import {
	normalizeGeneratedRepositorySlug,
	normalizeRepositoryName,
	normalizeRepositorySlug,
} from './repository.helpers'

describe('repository helpers', () => {
	test('trims repository names', () => {
		expect(normalizeRepositoryName('  Tessera Notes  ')).toBe(
			'Tessera Notes' as RepositoryName
		)
	})

	test('rejects blank repository names', () => {
		expect(() => normalizeRepositoryName('   ')).toThrow(
			InvalidRepositoryNameError
		)
	})

	test('rejects repository names longer than the contract limit', () => {
		expect(() => normalizeRepositoryName('a'.repeat(121))).toThrow(
			InvalidRepositoryNameError
		)
	})

	test('normalizes custom and generated slugs', () => {
		expect(normalizeRepositorySlug(' Tessera Notes!! ')).toBe(
			'tessera-notes' as RepositorySlug
		)
	})

	test('rejects slugs that cannot produce a valid value', () => {
		expect(() => normalizeRepositorySlug('---')).toThrow(
			InvalidRepositorySlugError
		)
	})

	test('rejects slugs longer than the contract limit', () => {
		expect(() => normalizeRepositorySlug('a'.repeat(65))).toThrow(
			InvalidRepositorySlugError
		)
	})

	test('truncates generated slugs to the contract limit', () => {
		expect(normalizeGeneratedRepositorySlug('a'.repeat(120))).toBe(
			'a'.repeat(64) as RepositorySlug
		)
	})

	test('trims trailing dashes after generated slug truncation', () => {
		expect(normalizeGeneratedRepositorySlug(`${'a'.repeat(63)} !!!`)).toBe(
			'a'.repeat(63) as RepositorySlug
		)
	})

	test('rejects generated slugs that cannot produce a valid value', () => {
		expect(() => normalizeGeneratedRepositorySlug('---')).toThrow(
			InvalidRepositorySlugError
		)
	})
})
