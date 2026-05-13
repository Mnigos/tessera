import type { CreateGitAccessTokenInput } from '@repo/contracts'
import { useState } from 'react'
import { useCreateGitAccessTokenMutation } from '../hooks/use-create-git-access-token.mutation'
import { useGitAccessTokensListQuery } from '../hooks/use-git-access-tokens-list.query'
import { useRevokeGitAccessTokenMutation } from '../hooks/use-revoke-git-access-token.mutation'
import { CreateGitAccessTokenForm } from './create-git-access-token-form'
import { GitAccessTokensList } from './git-access-tokens-list'

interface GitAccessTokensSectionProps {
	enabled: boolean
}

export function GitAccessTokensSection({
	enabled,
}: Readonly<GitAccessTokensSectionProps>) {
	const [createdToken, setCreatedToken] = useState<string>()
	const [permissionsError, setPermissionsError] = useState(false)
	const {
		data: accessTokensData,
		isError: isAccessTokensError,
		isLoading: isAccessTokensLoading,
	} = useGitAccessTokensListQuery(enabled)
	const createAccessToken = useCreateGitAccessTokenMutation()
	const revokeAccessToken = useRevokeGitAccessTokenMutation()

	function handleSubmit(
		input: CreateGitAccessTokenInput,
		form: HTMLFormElement
	) {
		setPermissionsError(false)
		createAccessToken.mutate(input, {
			onSuccess: ({ token }) => {
				setCreatedToken(token)
				form.reset()
			},
		})
	}

	return (
		<section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
			<GitAccessTokensList
				accessTokens={accessTokensData?.accessTokens ?? []}
				isError={isAccessTokensError}
				isLoading={isAccessTokensLoading}
				onRevoke={id => revokeAccessToken.mutate({ id })}
				revokingId={
					revokeAccessToken.isPending
						? revokeAccessToken.variables?.id
						: undefined
				}
			/>
			<CreateGitAccessTokenForm
				createdToken={createdToken}
				isError={createAccessToken.isError}
				isPending={createAccessToken.isPending}
				onPermissionsError={() => setPermissionsError(true)}
				onSubmit={handleSubmit}
				permissionsError={permissionsError}
			/>
		</section>
	)
}
