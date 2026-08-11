import { repositoryCloneUrlsSchema } from '@repo/contracts'
import type { RepositoryExternalSourceReadModel } from './repository'
import { toRepositoryCloneUrls } from './repository-clone-urls'

const BASE_URLS = {
	http: 'http://git.localhost/',
	ssh: 'ssh://git@git.localhost:2222',
}

const TARGET = {
	baseUrls: BASE_URLS,
	ownerUsername: 'marta',
	slug: 'notes',
}

function externalSource(
	overrides: Partial<RepositoryExternalSourceReadModel> = {}
) {
	return {
		mirrorMode: 'github_to_tessera',
		fullName: 'marta/upstream-notes',
		sourceUrl: 'https://github.com/marta/upstream-notes',
		...overrides,
	} as RepositoryExternalSourceReadModel
}

describe('repository clone URLs', () => {
	test('points a native repository at Tessera, without doubling the base slash', () => {
		expect(toRepositoryCloneUrls(TARGET)).toEqual({
			authority: 'tessera',
			https: 'http://git.localhost/marta/notes.git',
			ssh: 'ssh://git@git.localhost:2222/marta/notes.git',
		})
	})

	test('points a running mirror at GitHub, where pushes are actually accepted', () => {
		expect(
			toRepositoryCloneUrls({ ...TARGET, externalSource: externalSource() })
		).toEqual({
			authority: 'github',
			https: 'https://github.com/marta/upstream-notes.git',
			ssh: 'git@github.com:marta/upstream-notes.git',
		})
	})

	test('keeps an imported snapshot on Tessera, because nothing owns it upstream', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({ mirrorMode: 'imported' }),
			}).authority
		).toBe('tessera')
	})

	test('returns to Tessera once authority has cut over', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({ mirrorMode: 'tessera_source' }),
			})
		).toEqual({
			authority: 'tessera',
			https: 'http://git.localhost/marta/notes.git',
			ssh: 'ssh://git@git.localhost:2222/marta/notes.git',
		})
	})

	test('derives the host from the source URL so an Enterprise mirror survives', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({
					fullName: 'platform/notes',
					sourceUrl: 'https://github.acme.internal/platform/notes',
				}),
			})
		).toEqual({
			authority: 'github',
			https: 'https://github.acme.internal/platform/notes.git',
			ssh: 'git@github.acme.internal:platform/notes.git',
		})
	})

	// scp-like syntax reads everything after the colon as a path, so a port kept
	// on the SSH form would produce a remote nobody can clone.
	test('keeps a source port on HTTPS and drops it from the SSH remote', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({
					fullName: 'platform/notes',
					sourceUrl: 'https://github.acme.internal:8443/platform/notes',
				}),
			})
		).toEqual({
			authority: 'github',
			https: 'https://github.acme.internal:8443/platform/notes.git',
			ssh: 'git@github.acme.internal:platform/notes.git',
		})
	})

	test('preserves a plain-HTTP source scheme instead of promoting it', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({
					fullName: 'platform/notes',
					sourceUrl: 'http://github.acme.internal/platform/notes',
				}),
			}).https
		).toBe('http://github.acme.internal/platform/notes.git')
	})

	test('falls back to Tessera rather than guessing a host it cannot parse', () => {
		expect(
			toRepositoryCloneUrls({
				...TARGET,
				externalSource: externalSource({ sourceUrl: 'not-a-url' }),
			}).authority
		).toBe('tessera')
	})
})

describe('repository clone URL contract', () => {
	test.each([
		['a GitHub scp-form remote', 'git@github.com:marta/notes.git'],
		['a Tessera ssh URL', 'ssh://git@git.localhost:2222/marta/notes.git'],
	])('accepts %s', (_name, ssh) => {
		expect(
			repositoryCloneUrlsSchema.safeParse({
				authority: 'tessera',
				https: 'https://git.localhost/marta/notes.git',
				ssh,
			}).success
		).toBe(true)
	})

	// `z.url()` on its own accepts any scheme, and these are rendered as links
	// and offered for people to copy.
	test('rejects a non-web scheme in the HTTP clone URL', () => {
		expect(
			repositoryCloneUrlsSchema.safeParse({
				authority: 'tessera',
				https: 'javascript:alert(1)',
				ssh: 'git@github.com:marta/notes.git',
			}).success
		).toBe(false)
	})

	test('rejects an SSH remote that is neither form', () => {
		expect(
			repositoryCloneUrlsSchema.safeParse({
				authority: 'tessera',
				https: 'https://git.localhost/marta/notes.git',
				ssh: 'https://git.localhost/marta/notes.git',
			}).success
		).toBe(false)
	})

	test.each([
		['a native repository', undefined],
		['a running mirror', externalSource()],
		['an imported snapshot', externalSource({ mirrorMode: 'imported' })],
		[
			'a repository whose source is not a web address',
			externalSource({ sourceUrl: 'ssh://github.com/marta/notes' }),
		],
	])('derives clone URLs the contract accepts for %s', (_name, source) => {
		expect(
			repositoryCloneUrlsSchema.safeParse(
				toRepositoryCloneUrls({ ...TARGET, externalSource: source })
			).success
		).toBe(true)
	})
})
