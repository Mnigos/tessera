import type { SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId } from '@repo/domain'
import { Card } from '@repo/ui/components/card'
import { useSshPublicKeysListQuery } from '../hooks/use-ssh-public-keys-list.query'
import { SshPublicKeyListItem } from './ssh-public-key-list-item'
import { SshPublicKeysHeader } from './ssh-public-keys-header'

interface SshPublicKeysListProps {
	deletingId?: SshPublicKeyId
	enabled: boolean
	onDelete: (id: SshPublicKeyId) => void
}

export function SshPublicKeysList({
	deletingId,
	enabled,
	onDelete,
}: Readonly<SshPublicKeysListProps>) {
	const { data, isError, isLoading } = useSshPublicKeysListQuery(enabled)
	const sshPublicKeys: SshPublicKey[] = data?.sshPublicKeys ?? []

	if (isLoading)
		return (
			<section className="flex flex-col gap-3">
				<SshPublicKeysHeader />
				<div className="flex flex-col gap-2">
					<div className="h-24 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-24 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</section>
		)

	if (isError)
		return (
			<section className="flex flex-col gap-3">
				<SshPublicKeysHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					SSH public keys could not be loaded.
				</Card>
			</section>
		)

	if (sshPublicKeys.length === 0)
		return (
			<section className="flex flex-col gap-3">
				<SshPublicKeysHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					No SSH public keys yet.
				</Card>
			</section>
		)

	return (
		<section className="flex flex-col gap-3">
			<SshPublicKeysHeader />
			<Card className="gap-0 divide-y divide-border p-0">
				{sshPublicKeys.map(sshPublicKey => (
					<SshPublicKeyListItem
						deletingId={deletingId}
						key={sshPublicKey.id}
						onDelete={onDelete}
						sshPublicKey={sshPublicKey}
					/>
				))}
			</Card>
		</section>
	)
}
