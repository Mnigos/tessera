import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { type Contract, contract } from '@repo/contracts'

type GitE2EContract = Pick<
	Contract,
	'gitAccessTokens' | 'repositories' | 'sshPublicKeys'
>

export function createGitE2EORPCClient(apiBaseUrl: string, headers?: Headers) {
	const link = new OpenAPILink(contract, {
		url: apiBaseUrl,
		fetch: (request, init) =>
			fetch(request, {
				...init,
				credentials: 'include',
			}),
		headers: () => headers ?? {},
	})

	return createORPCClient(link) as ContractRouterClient<GitE2EContract>
}
