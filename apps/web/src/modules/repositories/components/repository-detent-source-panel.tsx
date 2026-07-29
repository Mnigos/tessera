import type { Repository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { ArrowUpRight } from 'lucide-react'

interface RepositoryDetentSourcePanelProps {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
}

export function RepositoryDetentSourcePanel({
	externalSource,
}: Readonly<RepositoryDetentSourcePanelProps>) {
	return (
		<Card className="gap-2 p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="font-semibold text-sm tracking-normal">
					Tessera is authoritative
				</h2>
				<span className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 text-xs">
					Tessera source
				</span>
			</div>
			<p className="flex min-w-0 items-center gap-1 text-muted-foreground text-sm">
				<span className="shrink-0">Formerly mirrored from</span>
				<a
					className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
					href={externalSource.sourceUrl}
					rel="noreferrer"
					target="_blank"
				>
					<span className="truncate">{externalSource.fullName}</span>
					<ArrowUpRight className="size-3 shrink-0" />
				</a>
			</p>
		</Card>
	)
}
