import { existsSync } from 'node:fs'
import {
	resolveGitAuthorizationProtoPath,
	resolveGitStorageProtoPath,
} from './git-storage-proto-paths'

describe('git storage proto paths', () => {
	test('resolves the git storage proto file from the repository root', () => {
		const protoPath = resolveGitStorageProtoPath()

		expect(protoPath).toContain(
			'packages/proto/tessera/git/v1/git_storage.proto'
		)
		expect(existsSync(protoPath)).toBe(true)
	})

	test('resolves the git authorization proto file from the repository root', () => {
		const protoPath = resolveGitAuthorizationProtoPath()

		expect(protoPath).toContain(
			'packages/proto/tessera/git/v1/git_authorization.proto'
		)
		expect(existsSync(protoPath)).toBe(true)
	})
})
