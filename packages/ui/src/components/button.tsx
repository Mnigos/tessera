import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cn } from '@repo/ui/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
	'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				// The press nudge is reserved for a real call to action; diff chrome keeps still.
				primary:
					'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-[0.98] active:bg-primary/85',
				accent:
					'bg-accent text-accent-foreground shadow-xs hover:bg-accent/80 active:bg-accent/70',
				secondary:
					'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 active:bg-secondary/70',
				outline:
					'border border-input bg-transparent text-foreground shadow-xs hover:border-muted-foreground/50 hover:bg-secondary/40 active:bg-secondary/60',
				link: 'bg-transparent text-foreground underline-offset-4 hover:text-primary hover:underline',
				ghost: 'hover:bg-muted hover:text-foreground',
				destructive:
					'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 active:scale-[0.98] active:bg-destructive/85',
			},
			size: {
				default: 'h-9 px-4 py-2',
				sm: 'h-8 rounded-md px-3 text-xs',
				lg: 'h-10 rounded-md px-8',
				icon: 'size-9',
			},
		},
		defaultVariants: {
			variant: 'primary',
			size: 'default',
		},
	}
)

export type ButtonProps = ButtonPrimitive.Props &
	VariantProps<typeof buttonVariants> &
	(
		| {
				variant?: Exclude<
					VariantProps<typeof buttonVariants>['variant'],
					'link'
				>
				isActive?: never
		  }
		| { variant: 'link'; isActive?: boolean }
	)

export function Button({
	className,
	variant,
	size,
	isActive = false,
	children,
	...props
}: Readonly<ButtonProps>) {
	return (
		<ButtonPrimitive
			className={cn(
				buttonVariants({ variant, size, className }),
				isActive && 'text-primary'
			)}
			data-slot="button"
			{...props}
		>
			{children}
		</ButtonPrimitive>
	)
}
