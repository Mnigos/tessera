import type { RepositoryId } from '@repo/domain'
import {
	getGitRepositoryWriteAuthorization,
	setGitRepositoryWriteAuthorization,
} from './git-repository-write-authorization.context'

const request = {
	ownerUsername: 'marta',
	repositorySlug: 'notes',
	service: 'git-receive-pack',
	action: 'write',
	basicUsername: 'marta',
	token: 'tes_git_raw-secret',
}

describe('git repository write authorization context', () => {
	test('stores authorization by RPC request identity', () => {
		const authorization = {
			repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		}

		setGitRepositoryWriteAuthorization(request, authorization)

		expect(getGitRepositoryWriteAuthorization(request)).toBe(authorization)
	})

	test('rejects requests without resolved authorization', () => {
		expect(() => getGitRepositoryWriteAuthorization({ ...request })).toThrow(
			'git repository write authorization'
		)
	})
})
