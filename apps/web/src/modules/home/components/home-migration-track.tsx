import { cn } from '@repo/ui/utils'

interface MigrationPosition {
	number: string
	name: string
	label: string
	body: string
	reached: boolean
}

const MIGRATION_POSITIONS: MigrationPosition[] = [
	{
		number: '01',
		name: 'Import',
		label: 'History, branches, tags, authors',
		body: 'Connect GitHub and bring repositories over with full history. Nothing is rewritten; commit hashes stay bit-for-bit identical.',
		reached: true,
	},
	{
		number: '02',
		name: 'Mirror',
		label: 'One-way sync, GitHub stays canonical',
		body: 'Browse and review in detent while pushes still land on GitHub. Run both, compare, and let the team settle in with zero risk.',
		reached: true,
	},
	{
		number: '03',
		name: 'Cut over',
		label: 'detent becomes the source of truth',
		body: 'Switch remotes when you are ready. Keep an optional push-back mirror so GitHub stays a warm standby for as long as you want one.',
		reached: false,
	},
]

export function HomeMigrationTrack() {
	return (
		<section
			className="mx-auto max-w-6xl scroll-mt-8 px-6 py-16 md:py-20"
			id="migration"
		>
			<div className="flex items-center gap-4 border-border/60 border-t pt-4">
				<span className="font-mono text-muted-foreground text-xs uppercase tracking-[0.12em]">
					Leaving GitHub, without the leap
				</span>
				<span aria-hidden="true" className="h-px flex-1 bg-border/60" />
			</div>
			<h2 className="mt-6 max-w-xl font-semibold text-3xl tracking-tight">
				Migration with three detents. Each one clicks, none of them slip.
			</h2>
			<p className="mt-3 max-w-2xl text-muted-foreground">
				Moving a team's source of truth should feel like turning a machined
				dial, not cutting a rope. The adoption path is reversible at every
				position until you choose otherwise.
			</p>
			<div className="mt-10 overflow-hidden rounded-md border border-border/60">
				{MIGRATION_POSITIONS.map(position => (
					<MigrationPositionRow key={position.number} position={position} />
				))}
			</div>
		</section>
	)
}

interface MigrationPositionRowProps {
	position: MigrationPosition
}

function MigrationPositionRow({
	position,
}: Readonly<MigrationPositionRowProps>) {
	const { number, name, label, body, reached } = position

	return (
		<div className="grid grid-cols-[3rem_1fr] border-border/60 border-t first:border-t-0 md:grid-cols-[4.5rem_16rem_1fr]">
			<div
				className={cn(
					'flex items-center justify-center border-border/60 border-r bg-card/50 py-6 font-mono text-xl tabular-nums',
					reached ? 'text-primary' : 'text-muted-foreground'
				)}
			>
				{number}
			</div>
			<div className="px-5 py-6 md:border-border/60 md:border-r">
				<strong className="block font-semibold text-base tracking-tight">
					{name}
				</strong>
				<span className="mt-1.5 block font-mono text-muted-foreground text-xs uppercase tracking-[0.12em]">
					{label}
				</span>
			</div>
			<p className="col-span-2 max-w-prose border-border/60 border-t px-5 py-6 text-muted-foreground text-sm md:col-span-1 md:border-t-0">
				{body}
			</p>
		</div>
	)
}
