import type { Repository, RepositoryOwner } from '@repo/contracts'
import { env } from '@/env'

interface RepositoryCloneFields {
	cloneUrl?: string
	httpCloneUrl?: string
}

const trailingSlashesRegex = /\/+$/

export function getRepositoryCloneUrl(
	repository: Repository,
	owner: RepositoryOwner
) {
	const cloneFields = repository as Repository & RepositoryCloneFields

	if (cloneFields.httpCloneUrl) return cloneFields.httpCloneUrl
	if (cloneFields.cloneUrl) return cloneFields.cloneUrl

	return `${env.VITE_PUBLIC_GIT_HTTP_BASE_URL.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}
