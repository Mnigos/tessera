import { KeyRound } from 'lucide-react'

export function GitAccessTokensHeader() {
	return (
		<div>
			<h2 className="flex items-center gap-2 font-semibold text-xl tracking-normal">
				<KeyRound className="size-5" />
				Git access tokens
			</h2>
			<p className="text-muted-foreground text-sm">
				Tokens for authenticated Git operations.
			</p>
		</div>
	)
}
