import type { RepositoryName, RepositorySlug } from '@repo/domain'
import {
	InvalidRepositoryNameError,
	InvalidRepositorySlugError,
} from './repository.errors'
import {
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
})
