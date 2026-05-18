import type { GpgPublicKey } from '@repo/contracts'
import type { GpgPublicKeyId } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Trash2 } from 'lucide-react'

interface GpgPublicKeyListItemProps {
	deletingId?: GpgPublicKeyId
	gpgPublicKey: GpgPublicKey
	onDelete: (id: GpgPublicKeyId) => void
}

export function GpgPublicKeyListItem({
	deletingId,
	gpgPublicKey,
	onDelete,
}: Readonly<GpgPublicKeyListItemProps>) {
	return (
		<div className="flex items-start justify-between gap-4 p-4">
			<div className="flex min-w-0 flex-col gap-2">
				<div className="flex min-w-0 flex-col gap-1">
					<h3 className="truncate font-medium text-base">
						{gpgPublicKey.title}
					</h3>
					<p className="truncate text-muted-foreground text-sm">
						{gpgPublicKey.keyId} · {gpgPublicKey.fingerprint}
					</p>
				</div>
				<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<span>Created {formatGpgPublicKeyDate(gpgPublicKey.createdAt)}</span>
					<span>
						{gpgPublicKey.lastUsedAt
							? `Last used ${formatGpgPublicKeyDate(gpgPublicKey.lastUsedAt)}`
							: 'Never used'}
					</span>
					<span>
						Key issued {formatGpgPublicKeyDate(gpgPublicKey.keyCreatedAt)}
					</span>
					<span>
						{gpgPublicKey.keyExpiresAt
							? `Expires ${formatGpgPublicKeyDate(gpgPublicKey.keyExpiresAt)}`
							: 'No expiration'}
					</span>
					{gpgPublicKey.isRevoked && <span>Revoked</span>}
				</div>
				{gpgPublicKey.emails.length > 0 && (
					<p className="truncate text-muted-foreground text-xs">
						{gpgPublicKey.emails.join(', ')}
					</p>
				)}
			</div>
			<Button
				aria-label="Delete GPG public key"
				disabled={deletingId === gpgPublicKey.id}
				onClick={() => onDelete(gpgPublicKey.id)}
				size="icon"
				type="button"
				variant="outline"
			>
				<Trash2 className="size-4" />
			</Button>
		</div>
	)
}

function formatGpgPublicKeyDate(date: Date) {
	return date.toISOString().split('T')[0]
}
