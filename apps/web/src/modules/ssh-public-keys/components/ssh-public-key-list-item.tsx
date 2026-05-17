import type { SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Trash2 } from 'lucide-react'

interface SshPublicKeyListItemProps {
	deletingId?: string
	onDelete: (id: SshPublicKeyId) => void
	sshPublicKey: SshPublicKey
}

export function SshPublicKeyListItem({
	deletingId,
	onDelete,
	sshPublicKey,
}: Readonly<SshPublicKeyListItemProps>) {
	return (
		<div className="flex items-start justify-between gap-4 p-4">
			<div className="flex min-w-0 flex-col gap-2">
				<div className="flex min-w-0 flex-col gap-1">
					<h3 className="truncate font-medium text-base">
						{sshPublicKey.title}
					</h3>
					<p className="truncate text-muted-foreground text-sm">
						{sshPublicKey.keyType} · {sshPublicKey.fingerprintSha256}
					</p>
				</div>
				<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<span>Created {formatSshPublicKeyDate(sshPublicKey.createdAt)}</span>
					{sshPublicKey.comment && <span>{sshPublicKey.comment}</span>}
				</div>
			</div>
			<Button
				aria-label="Delete SSH public key"
				disabled={deletingId === sshPublicKey.id}
				onClick={() => onDelete(sshPublicKey.id)}
				size="icon"
				type="button"
				variant="outline"
			>
				<Trash2 className="size-4" />
			</Button>
		</div>
	)
}

function formatSshPublicKeyDate(date: Date) {
	return date.toISOString().split('T')[0]
}
