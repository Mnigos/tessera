import type { Repository, RepositoryOwner } from '@repo/contracts'

interface RepositoryCloneFields {
	cloneUrl?: string
	httpCloneUrl?: string
}

const importMetaEnv = (
	import.meta as ImportMeta & {
		env?: Record<string, string | undefined>
	}
).env
const trailingSlashesRegex = /\/+$/

export function getRepositoryCloneUrl(
	repository: Repository,
	owner: RepositoryOwner
) {
	const cloneFields = repository as Repository & RepositoryCloneFields

	if (cloneFields.httpCloneUrl) return cloneFields.httpCloneUrl
	if (cloneFields.cloneUrl) return cloneFields.cloneUrl

	const gitHttpBaseUrl =
		importMetaEnv?.VITE_PUBLIC_GIT_HTTP_BASE_URL ??
		importMetaEnv?.VITE_GIT_HTTP_BASE_URL

	if (!gitHttpBaseUrl) return undefined

	return `${gitHttpBaseUrl.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}
