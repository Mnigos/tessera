import { populateContractRouterPaths } from '@orpc/nest'
import { contract as baseContract } from '@repo/contracts'

export const contract = populateContractRouterPaths(baseContract)

export type Contract = typeof contract
