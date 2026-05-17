export * from './src/auth.contract'
export * from './src/git-access-tokens.contract'
export * from './src/health.contract'
export * from './src/organizations.contract'
export * from './src/repositories.contract'
export * from './src/ssh-public-keys.contract'
export * from './src/user.contract'

import { authContract } from './src/auth.contract'
import { gitAccessTokensContract } from './src/git-access-tokens.contract'
import { healthContract } from './src/health.contract'
import { organizationsContract } from './src/organizations.contract'
import { repositoriesContract } from './src/repositories.contract'
import { sshPublicKeysContract } from './src/ssh-public-keys.contract'
import { userContract } from './src/user.contract'

export const contract = {
	auth: authContract,
	gitAccessTokens: gitAccessTokensContract,
	health: healthContract,
	organizations: organizationsContract,
	repositories: repositoriesContract,
	sshPublicKeys: sshPublicKeysContract,
	user: userContract,
}

export type Contract = typeof contract
