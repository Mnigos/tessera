import type {
	AuthorizeSshWriteRequest,
	AuthorizeWriteRequest,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { InternalError } from '~/shared/errors'
import type { GitRepositoryAuthorization } from '../application/repositories.service'

export type GitRepositoryWriteRequest =
	| AuthorizeWriteRequest
	| AuthorizeSshWriteRequest

const AUTHORIZATIONS = new WeakMap<
	GitRepositoryWriteRequest,
	GitRepositoryAuthorization
>()

export function setGitRepositoryWriteAuthorization(
	request: GitRepositoryWriteRequest,
	authorization: GitRepositoryAuthorization
): void {
	AUTHORIZATIONS.set(request, authorization)
}

export function getGitRepositoryWriteAuthorization(
	request: GitRepositoryWriteRequest
): GitRepositoryAuthorization {
	const authorization = AUTHORIZATIONS.get(request)

	if (!authorization)
		throw new InternalError('git repository write authorization')

	return authorization
}
