import { cn } from '@repo/ui/utils'

interface DetentMarkProps {
	className?: string
}

export function DetentMark({ className }: DetentMarkProps) {
	return (
		<svg
			aria-hidden="true"
			className={cn('size-5', className)}
			fill="none"
			viewBox="0 0 24 24"
		>
			<circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" />
			<g
				className="text-muted-foreground"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<path d="M12 2.5v3M21.5 12h-3M12 21.5v-3M2.5 12h3" />
				<path d="M18.7 5.3l-2.1 2.1M18.7 18.7l-2.1-2.1M5.3 18.7l2.1-2.1" />
			</g>
			<path
				className="text-primary"
				d="M5.3 5.3l2.8 2.8"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<circle
				className="text-primary"
				cx="12"
				cy="12"
				fill="currentColor"
				r="2"
			/>
		</svg>
	)
}
