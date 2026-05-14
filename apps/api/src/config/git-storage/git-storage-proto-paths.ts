import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const GIT_STORAGE_PROTO_RELATIVE_PATH =
	'packages/proto/tessera/git/v1/git_storage.proto'
const GIT_AUTHORIZATION_PROTO_RELATIVE_PATH =
	'packages/proto/tessera/git/v1/git_authorization.proto'

export function resolveGitStorageProtoPath() {
	return resolveProtoPath(GIT_STORAGE_PROTO_RELATIVE_PATH)
}

export function resolveGitAuthorizationProtoPath() {
	return resolveProtoPath(GIT_AUTHORIZATION_PROTO_RELATIVE_PATH)
}

function resolveProtoPath(relativePath: string) {
	const candidates = [
		resolve(process.cwd(), relativePath),
		resolve(process.cwd(), '../../', relativePath),
	]

	return (
		candidates.find(candidate => existsSync(candidate)) ?? resolve(relativePath)
	)
}
