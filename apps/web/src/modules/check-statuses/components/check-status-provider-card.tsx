import type {
	CheckStatusCredential,
	CheckStatusProvider,
	CreatedCheckStatusCredential,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { KeyRound, RotateCw } from 'lucide-react'
import { getCheckStatusErrorMessage } from '../helpers/get-check-status-error-message'
import { useCreateCheckStatusCredentialMutation } from '../hooks/use-create-check-status-credential.mutation'
import { useRevokeCheckStatusCredentialMutation } from '../hooks/use-revoke-check-status-credential.mutation'

interface CheckStatusProviderCardProps {
	onCredentialCreated: (created: CreatedCheckStatusCredential) => void
	provider: CheckStatusProvider
	username: string
	slug: string
}

export function CheckStatusProviderCard({
	onCredentialCreated,
	provider,
	username,
	slug,
}: Readonly<CheckStatusProviderCardProps>) {
	const createCredential = useCreateCheckStatusCredentialMutation()
	const revokeCredential = useRevokeCheckStatusCredentialMutation()
	const liveCredentials = provider.credentials.filter(isLiveCredential)

	return (
		<Card className="gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<h3 className="truncate font-semibold text-base tracking-normal">
						{provider.displayName}
					</h3>
					<code className="text-muted-foreground text-xs">{provider.key}</code>
				</div>
				<Button
					disabled={createCredential.isPending}
					onClick={() =>
						createCredential.mutate(
							{ username, slug, providerId: provider.id },
							{ onSuccess: onCredentialCreated }
						)
					}
					size="sm"
					type="button"
					variant="outline"
				>
					<RotateCw className="size-4" />
					{createCredential.isPending ? 'Issuing' : 'Issue token'}
				</Button>
			</div>
			{createCredential.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getCheckStatusErrorMessage(
						createCredential.error,
						'Token could not be issued.'
					)}
				</p>
			)}
			{liveCredentials.length === 0 ? (
				<p className="text-muted-foreground text-sm italic">
					No live tokens. This provider cannot publish until one is issued.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border">
					{liveCredentials.map(credential => (
						<CheckStatusCredentialRow
							credential={credential}
							isRevoking={
								revokeCredential.isPending &&
								revokeCredential.variables?.credentialId === credential.id
							}
							key={credential.id}
							onRevoke={() =>
								revokeCredential.mutate({
									username,
									slug,
									credentialId: credential.id,
								})
							}
						/>
					))}
				</ul>
			)}
			{revokeCredential.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getCheckStatusErrorMessage(
						revokeCredential.error,
						'Token could not be revoked.'
					)}
				</p>
			)}
		</Card>
	)
}

interface CheckStatusCredentialRowProps {
	credential: CheckStatusCredential
	isRevoking: boolean
	onRevoke: () => void
}

function CheckStatusCredentialRow({
	credential,
	isRevoking,
	onRevoke,
}: Readonly<CheckStatusCredentialRowProps>) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
			<div className="flex min-w-0 items-center gap-2">
				<KeyRound
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<code className="truncate font-mono text-sm">
					{credential.start ? `${credential.start}…` : 'tes_status_…'}
				</code>
			</div>
			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span>
					{credential.lastUsedAt
						? `Last used ${formatCredentialDate(credential.lastUsedAt)}`
						: 'Never used'}
				</span>
				<Button
					disabled={isRevoking}
					onClick={onRevoke}
					size="sm"
					type="button"
					variant="ghost"
				>
					{isRevoking ? 'Revoking' : 'Revoke'}
				</Button>
			</div>
		</li>
	)
}

/**
 * A credential the guard would still accept. A revoked or disabled one is not a
 * token an admin has to think about any more, and an expired one has stopped
 * working whatever this list says.
 */
function isLiveCredential({
	enabled,
	expiresAt,
	revokedAt,
}: CheckStatusCredential): boolean {
	if (revokedAt || !enabled) return false

	return !expiresAt || expiresAt.getTime() > Date.now()
}

function formatCredentialDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}
