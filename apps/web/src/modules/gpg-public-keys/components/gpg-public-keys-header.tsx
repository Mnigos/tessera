export function GpgPublicKeysHeader() {
	return (
		<div className="flex flex-col gap-1">
			<h2 className="font-semibold text-lg tracking-normal">GPG keys</h2>
			<p className="text-muted-foreground text-sm">
				Manage public keys used to verify commit and tag signatures.
			</p>
		</div>
	)
}
