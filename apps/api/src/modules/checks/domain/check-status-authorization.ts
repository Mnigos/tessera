import type {
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
} from '@repo/domain'

/**
 * What an external publisher was proven to be, before it says a word about the
 * commit it is reporting on.
 *
 * The ledger takes this instead of trusting the request because provider
 * identity is the one field a publisher must never be able to choose for
 * itself; whoever establishes it hands the finished answer over, and the write
 * path has no way to construct one.
 */
export interface CheckStatusCredentialAuthorization {
	credentialId: CheckStatusCredentialId
	providerId: CheckStatusProviderId
	repositoryId: RepositoryId
}
