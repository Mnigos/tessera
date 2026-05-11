import { cn } from '@repo/ui/utils'
import type { HTMLAttributes } from 'react'

export function Card({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-foreground shadow-sm',
				className
			)}
			{...props}
		/>
	)
}

export function CardHeader({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return <div className={cn('flex flex-col gap-1', className)} {...props} />
}

export function CardTitle({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return (
		<div
			className={cn(
				'font-semibold text-xl leading-none tracking-tight',
				className
			)}
			{...props}
		/>
	)
}

export function CardDescription({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return (
		<div
			className={cn('text-muted-foreground text-sm', className)}
			{...props}
		/>
	)
}

export function CardContent({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return <div className={cn('pt-2', className)} {...props} />
}

export function CardFooter({
	className,
	...props
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
	return <div className={cn('flex items-center pt-0', className)} {...props} />
}
