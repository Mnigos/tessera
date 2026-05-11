import { cva, type VariantProps } from 'class-variance-authority'

export const toggleVariants = cva(
	"inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-pressed:text-foreground dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: 'bg-transparent data-pressed:bg-secondary',
				outline:
					'border border-border bg-transparent shadow-xs hover:bg-muted hover:text-foreground data-pressed:border-border data-pressed:bg-secondary',
				accent:
					'bg-transparent hover:bg-primary/10 hover:text-foreground data-pressed:bg-primary data-pressed:text-foreground',
			},
			size: {
				default: 'h-9 min-w-9 px-2',
				sm: 'h-8 min-w-8 px-1.5',
				lg: 'h-10 min-w-10 px-2.5',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	}
)

export type ToggleVariantProps = VariantProps<typeof toggleVariants>
