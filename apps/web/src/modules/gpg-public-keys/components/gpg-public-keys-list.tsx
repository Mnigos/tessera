import type { GpgPublicKey } from '@repo/contracts'
import type { GpgPublicKeyId } from '@repo/domain'
import { Card } from '@repo/ui/components/card'
import { useGpgPublicKeysListQuery } from '../hooks/use-gpg-public-keys-list.query'
import { GpgPublicKeyListItem } from './gpg-public-key-list-item'
import { GpgPublicKeysHeader } from './gpg-public-keys-header'

interface GpgPublicKeysListProps {
	deletingId?: GpgPublicKeyId
	enabled: boolean
	onDelete: (id: GpgPublicKeyId) => void
}

export function GpgPublicKeysList({
	deletingId,
	enabled,
	onDelete,
}: Readonly<GpgPublicKeysListProps>) {
	const { data, isError, isLoading } = useGpgPublicKeysListQuery(enabled)
	const gpgPublicKeys: GpgPublicKey[] = data?.gpgPublicKeys ?? []

	if (isLoading)
		return (
			<section className="flex flex-col gap-3">
				<GpgPublicKeysHeader />
				<div className="flex flex-col gap-2">
					<div className="h-28 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-28 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</section>
		)

	if (isError)
		return (
			<section className="flex flex-col gap-3">
				<GpgPublicKeysHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					GPG public keys could not be loaded.
				</Card>
			</section>
		)

	if (gpgPublicKeys.length === 0)
		return (
			<section className="flex flex-col gap-3">
				<GpgPublicKeysHeader />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					No GPG public keys yet.
				</Card>
			</section>
		)

	return (
		<section className="flex flex-col gap-3">
			<GpgPublicKeysHeader />
			<Card className="gap-0 divide-y divide-border p-0">
				{gpgPublicKeys.map(gpgPublicKey => (
					<GpgPublicKeyListItem
						deletingId={deletingId}
						gpgPublicKey={gpgPublicKey}
						key={gpgPublicKey.id}
						onDelete={onDelete}
					/>
				))}
			</Card>
		</section>
	)
}
