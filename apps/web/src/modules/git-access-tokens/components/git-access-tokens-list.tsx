import type { GitAccessToken } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { GitAccessTokenListItem } from './git-access-token-list-item'
import { GitAccessTokensHeader } from './git-access-tokens-header'

interface GitAccessTokensListProps {
	accessTokens: GitAccessToken[]
	isLoading: boolean
	isError: boolean
	onRevoke: (id: GitAccessToken['id']) => void
	revokingId?: string
}

export function GitAccessTokensList({
	accessTokens,
	isLoading,
	isError,
	onRevoke,
	revokingId,
}: Readonly<GitAccessTokensListProps>) {
	if (isLoading)
		return (
			<section className="flex flex-col gap-3">
				<GitAccessTokensHeader />
				<div className="flex flex-col gap-2">
					<div className="h-20 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-20 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</section>
		)

	if (isError)
		return (
			<section className="flex flex-col gap-3">
				<GitAccessTokensHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					Git tokens could not be loaded.
				</Card>
			</section>
		)

	if (accessTokens.length === 0)
		return (
			<section className="flex flex-col gap-3">
				<GitAccessTokensHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					No Git tokens yet.
				</Card>
			</section>
		)

	return (
		<section className="flex flex-col gap-3">
			<GitAccessTokensHeader />
			<Card className="gap-0 divide-y divide-border p-0">
				{accessTokens.map(accessToken => (
					<GitAccessTokenListItem
						accessToken={accessToken}
						key={accessToken.id}
						onRevoke={onRevoke}
						revokingId={revokingId}
					/>
				))}
			</Card>
		</section>
	)
}
