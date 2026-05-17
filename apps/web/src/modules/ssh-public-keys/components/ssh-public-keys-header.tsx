import { KeyRound } from 'lucide-react'

export function SshPublicKeysHeader() {
	return (
		<div>
			<h2 className="flex items-center gap-2 font-semibold text-xl tracking-normal">
				<KeyRound className="size-5" />
				SSH public keys
			</h2>
			<p className="text-muted-foreground text-sm">
				Keys for authenticated Git over SSH.
			</p>
		</div>
	)
}
