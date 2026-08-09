import { Card } from '@repo/ui/components/card'
import { KeyRound } from 'lucide-react'

interface CheckStatusCredentialSecretProps {
	providerDisplayName: string
	token: string
}

/**
 * The only time the secret is readable. Tessera stores a hash and can never show
 * it again, so the card says so plainly rather than letting a reader assume they
 * can come back for it.
 */
export function CheckStatusCredentialSecret({
	providerDisplayName,
	token,
}: Readonly<CheckStatusCredentialSecretProps>) {
	return (
		<Card className="gap-3 border-emerald-500/40 bg-emerald-500/5">
			<div className="flex items-center gap-2">
				<KeyRound aria-hidden className="size-4 text-emerald-400" />
				<h2 className="font-semibold text-base tracking-normal">
					Token for {providerDisplayName}
				</h2>
			</div>
			<p className="text-muted-foreground text-sm">
				Copy it into your CI now. This is the only time it is shown.
			</p>
			<code className="break-all rounded bg-background px-3 py-2 font-mono text-xs">
				{token}
			</code>
		</Card>
	)
}
