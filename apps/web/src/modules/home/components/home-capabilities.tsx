import type { LucideIcon } from 'lucide-react'
import { Activity, GitPullRequest, Plug, ShieldCheck } from 'lucide-react'

interface Capability {
	icon: LucideIcon
	title: string
	body: string
}

const CAPABILITIES: Capability[] = [
	{
		icon: Activity,
		title: 'Reading-grade code browsing',
		body: 'File trees, blame, and history tuned for long sessions: stable layout, tabular numerals, no reflow surprises mid-scroll.',
	},
	{
		icon: GitPullRequest,
		title: 'Reviews that measure change',
		body: 'Pull requests with precise diffs, required approvals, and branch protection that reads like an interlock, not a checkbox maze.',
	},
	{
		icon: ShieldCheck,
		title: 'Keys, tokens, signatures',
		body: 'SSH and GPG keys, scoped access tokens, verified commit badges. The security surface is small, explicit, and auditable.',
	},
	{
		icon: Plug,
		title: 'Integrations, not imitations',
		body: 'detent is not your CI, issue tracker, or chat. It connects to the tools you already trust and stays excellent at Git.',
	},
]

export function HomeCapabilities() {
	return (
		<section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
			<div className="flex items-center gap-4 border-border/60 border-t pt-4">
				<span className="font-mono text-muted-foreground text-xs uppercase tracking-[0.12em]">
					Calibrated for the daily work
				</span>
				<span aria-hidden="true" className="h-px flex-1 bg-border/60" />
			</div>
			<div className="mt-8 grid grid-cols-1 border-border/60 border-t sm:grid-cols-2">
				{CAPABILITIES.map(({ icon: Icon, title, body }) => (
					<div
						className="border-border/60 border-b py-7 pr-8 sm:even:pl-10 sm:odd:border-r sm:odd:pr-10"
						key={title}
					>
						<Icon aria-hidden="true" className="size-5 text-primary" />
						<h3 className="mt-3.5 font-semibold tracking-tight">{title}</h3>
						<p className="mt-2 max-w-prose text-muted-foreground text-sm">
							{body}
						</p>
					</div>
				))}
			</div>
		</section>
	)
}
