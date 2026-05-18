import type { Repository, RepositoryOwner } from '@repo/contracts'
import { env } from '@/env'

interface RepositoryWithCloneFields extends Repository {
	cloneUrl?: string
	httpCloneUrl?: string
	sshCloneUrl?: string
}

const trailingSlashesRegex = /\/+$/

export function getRepositoryHttpCloneUrl(
	repository: RepositoryWithCloneFields,
	owner: RepositoryOwner
) {
	if (repository.httpCloneUrl) return repository.httpCloneUrl
	if (repository.cloneUrl) return repository.cloneUrl

	return `${env.VITE_PUBLIC_GIT_HTTP_BASE_URL.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}

export function getRepositorySshCloneUrl(
	repository: RepositoryWithCloneFields,
	owner: RepositoryOwner
) {
	if (repository.sshCloneUrl) return repository.sshCloneUrl

	return `${env.VITE_PUBLIC_GIT_SSH_BASE_URL.replace(trailingSlashesRegex, '')}/${owner.username}/${repository.slug}.git`
}
