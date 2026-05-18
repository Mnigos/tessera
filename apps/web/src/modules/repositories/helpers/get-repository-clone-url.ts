import type { Repository, RepositoryOwner } from '@repo/contracts'
import { env } from '@/env'

interface RepositoryCloneFields {
	cloneUrl?: string
	httpCloneUrl?: string
	sshCloneUrl?: string
}

const trailingSlashesRegex = /\/+$/

export function getRepositoryHttpCloneUrl(
	repository: Repository,
	owner: RepositoryOwner
) {
	const cloneFields = repository as Repository & RepositoryCloneFields

	if (cloneFields.httpCloneUrl) return cloneFields.httpCloneUrl
	if (cloneFields.cloneUrl) return cloneFields.cloneUrl

	return `${env.VITE_PUBLIC_GIT_HTTP_BASE_URL.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}

export function getRepositorySshCloneUrl(
	repository: Repository,
	owner: RepositoryOwner
) {
	const cloneFields = repository as Repository & RepositoryCloneFields

	if (cloneFields.sshCloneUrl) return cloneFields.sshCloneUrl

	return `${env.VITE_PUBLIC_GIT_SSH_BASE_URL.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}
