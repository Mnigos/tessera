import { cn } from '@repo/ui/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

const alertVariants = cva(
	'relative w-full rounded-lg border border-border bg-card px-3 py-2.5 text-foreground text-sm has-[>svg]:pl-10 [&>svg]:absolute [&>svg]:top-3.5 [&>svg]:left-3 [&>svg]:size-4 [&>svg]:text-current',
	{
		variants: {
			variant: {
				default: 'bg-card text-foreground',
				destructive:
					'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	}
)

export function Alert({
	className,
	variant,
	...props
}: Readonly<ComponentProps<'div'> & VariantProps<typeof alertVariants>>) {
	return (
		<div
			className={cn(alertVariants({ variant }), className)}
			data-slot="alert"
			role="alert"
			{...props}
		/>
	)
}

export function AlertTitle({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn(
				'line-clamp-1 min-h-4 font-medium tracking-tight',
				className
			)}
			data-slot="alert-title"
			{...props}
		/>
	)
}

export function AlertDescription({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn(
				'grid justify-items-start gap-1 text-muted-foreground text-sm [&_p]:leading-relaxed',
				className
			)}
			data-slot="alert-description"
			{...props}
		/>
	)
}
