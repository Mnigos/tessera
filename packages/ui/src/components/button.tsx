import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cn } from '@repo/ui/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
	'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-all duration-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				primary:
					'bg-primary text-primary-foreground shadow-sm hover:bg-primary/80 hover:text-primary-foreground hover:shadow-primary/20 hover:shadow-xl active:bg-primary/80 active:text-primary-foreground active:shadow-primary/20 active:shadow-xl',
				accent:
					'bg-accent text-accent-foreground shadow-sm hover:bg-accent/80 hover:text-accent-foreground hover:shadow-accent/20 hover:shadow-xl active:bg-accent/80 active:text-accent-foreground active:shadow-accent/20 active:shadow-xl',
				secondary:
					'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 hover:shadow-secondary/20 hover:shadow-xl active:bg-secondary/80 active:text-secondary-foreground active:shadow-secondary/20 active:shadow-xl',
				outline:
					'relative isolate overflow-hidden border border-border bg-transparent text-foreground shadow-xs before:absolute before:inset-0 before:-z-10 before:-translate-x-full before:bg-secondary before:transition-transform before:duration-300 hover:text-secondary-foreground hover:before:w-full hover:before:translate-x-0 active:bg-secondary active:text-secondary-foreground active:shadow-secondary/20 active:shadow-xl',
				link: 'relative overflow-hidden bg-transparent text-foreground shadow-xs before:absolute before:right-0 before:bottom-0 before:left-0 before:-z-10 before:h-px before:-translate-x-full before:bg-primary before:transition-transform before:duration-300 hover:shadow-primary/40 hover:shadow-sm hover:before:w-full hover:before:translate-x-0',
				ghost: 'hover:bg-muted hover:text-foreground hover:shadow-xl',
				destructive:
					'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80 hover:text-destructive-foreground hover:shadow-destructive/30 hover:shadow-xl',
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
				isActive && 'shadow-primary/40'
			)}
			data-slot="button"
			{...props}
		>
			{children}
		</ButtonPrimitive>
	)
}
