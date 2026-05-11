export * from './src/auth.contract'
export * from './src/health.contract'
export * from './src/organizations.contract'
export * from './src/repositories.contract'
export * from './src/user.contract'

import { authContract } from './src/auth.contract'
import { healthContract } from './src/health.contract'
import { organizationsContract } from './src/organizations.contract'
import { repositoriesContract } from './src/repositories.contract'
import { userContract } from './src/user.contract'

export const contract = {
	auth: authContract,
	health: healthContract,
	organizations: organizationsContract,
	repositories: repositoriesContract,
	user: userContract,
}

export type Contract = typeof contract
