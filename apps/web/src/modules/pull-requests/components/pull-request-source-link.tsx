import { cn } from '@repo/ui/utils'
import { ArrowUpRight } from 'lucide-react'

interface PullRequestSourceLinkProps {
	href: string
	label?: string
	className?: string
}

/**
 * Sends the reader to the copy of a synchronized conversation that they can
 * actually act on. Tessera never writes back, so every synchronized surface
 * offers this way out.
 */
export function PullRequestSourceLink({
	href,
	label = 'View on GitHub',
	className,
}: Readonly<PullRequestSourceLinkProps>) {
	return (
		<a
			className={cn(
				'inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline',
				className
			)}
			href={href}
			rel="noreferrer"
			target="_blank"
		>
			<span className="truncate">{label}</span>
			<ArrowUpRight aria-hidden className="size-3 shrink-0" />
		</a>
	)
}
