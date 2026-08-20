import type { ReactNode } from 'react'

interface PullRequestSidebarSectionProps {
	title: string
	/** The section's own affordance, drawn opposite the heading. */
	action?: ReactNode
	children: ReactNode
}

/**
 * One band of the conversation sidebar: a quiet heading, whatever the section
 * has to say, and a hairline to the next one. Borders separate the sections
 * rather than boxing each of them.
 */
export function PullRequestSidebarSection({
	title,
	action,
	children,
}: Readonly<PullRequestSidebarSectionProps>) {
	return (
		<section className="flex flex-col gap-2 border-border border-b py-4 first:pt-0 last:border-b-0 last:pb-0">
			<div className="flex min-h-6 items-center justify-between gap-2">
				<h2 className="font-semibold text-foreground text-xs">{title}</h2>
				{action}
			</div>
			{children}
		</section>
	)
}
