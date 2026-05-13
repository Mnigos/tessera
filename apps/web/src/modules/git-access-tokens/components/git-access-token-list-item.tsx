import type { GitAccessToken } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Trash2 } from 'lucide-react'

interface GitAccessTokenListItemProps {
	accessToken: GitAccessToken
	onRevoke: (id: GitAccessToken['id']) => void
	revokingId?: string
}

export function GitAccessTokenListItem({
	accessToken,
	onRevoke,
	revokingId,
}: Readonly<GitAccessTokenListItemProps>) {
	return (
		<div className="flex items-start justify-between gap-4 p-4">
			<div className="flex min-w-0 flex-col gap-1">
				<h3 className="truncate font-medium text-base">
					{accessToken.name || 'Git access token'}
				</h3>
				<p className="truncate text-muted-foreground text-sm">
					{getAccessTokenMetadata(accessToken)}
				</p>
				<p className="text-muted-foreground text-xs">
					Created {formatAccessTokenDate(accessToken.createdAt)}
				</p>
			</div>
			<Button
				aria-label="Revoke token"
				disabled={revokingId === accessToken.id}
				onClick={() => onRevoke(accessToken.id)}
				size="icon"
				type="button"
				variant="outline"
			>
				<Trash2 className="size-4" />
			</Button>
		</div>
	)
}

function formatAccessTokenDate(date: Date) {
	return date.toISOString().split('T')[0]
}

function getAccessTokenMetadata(accessToken: GitAccessToken) {
	const prefix = accessToken.prefix ?? accessToken.start
	const permissions = getAccessTokenPermissions(accessToken)
	const details = [prefix, permissions].filter(Boolean)

	return details.length > 0 ? details.join(' · ') : 'Metadata only'
}

function getAccessTokenPermissions(accessToken: GitAccessToken) {
	const permissions = accessToken.permissions?.git

	return permissions?.length ? permissions.join(', ') : undefined
}
