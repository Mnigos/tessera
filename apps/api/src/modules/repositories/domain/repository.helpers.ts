import {
	brand,
	REPOSITORY_SLUG_REGEX,
	type RepositoryName,
	type RepositorySlug,
} from '@repo/domain'
import {
	InvalidRepositoryNameError,
	InvalidRepositorySlugError,
} from './repository.errors'

const REPOSITORY_NAME_MAX_LENGTH = 120
const REPOSITORY_SLUG_MAX_LENGTH = 64

export function normalizeRepositoryName(name: string): RepositoryName {
	const normalizedName = name.trim()

	if (!normalizedName || normalizedName.length > REPOSITORY_NAME_MAX_LENGTH)
		throw new InvalidRepositoryNameError(name)

	return brand<string, 'repository_name'>(normalizedName)
}

export function normalizeRepositorySlug(value: string): RepositorySlug {
	const normalizedSlug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')

	if (!REPOSITORY_SLUG_REGEX.test(normalizedSlug))
		throw new InvalidRepositorySlugError(value)

	if (normalizedSlug.length > REPOSITORY_SLUG_MAX_LENGTH)
		throw new InvalidRepositorySlugError(value)

	return brand<string, 'repository_slug'>(normalizedSlug)
}
