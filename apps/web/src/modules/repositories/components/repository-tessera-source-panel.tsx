import type { Repository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { MirrorTimestamp, SourceField } from './repository-github-mirror-fields'

interface RepositoryTesseraSourcePanelProps {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
}

export function RepositoryTesseraSourcePanel({
	externalSource,
}: Readonly<RepositoryTesseraSourcePanelProps>) {
	return (
		<Card className="gap-4 p-4">
			<div className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold text-base tracking-normal">
						Repository source
					</h2>
					<span className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 text-xs">
						Tessera source of truth
					</span>
				</div>
				<p className="text-muted-foreground text-sm">
					GitHub mirror controls are hidden because writes now belong in
					Tessera.
				</p>
			</div>
			<div className="grid gap-3 text-sm sm:grid-cols-3">
				<SourceField label="GitHub source" value={externalSource.fullName} />
				<MirrorTimestamp label="Cut over" value={externalSource.cutoverAt} />
				<SourceField
					label="Previous mode"
					value={externalSource.cutoverFromMirrorMode ?? 'GitHub mirror'}
				/>
			</div>
		</Card>
	)
}
