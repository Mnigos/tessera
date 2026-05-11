import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Table({
	className,
	...props
}: Readonly<ComponentProps<'table'>>) {
	return (
		<div className="relative mb-6 w-full overflow-x-auto rounded-lg border border-border/80 bg-card/70">
			<table
				className={cn('w-full caption-bottom text-sm', className)}
				{...props}
			/>
		</div>
	)
}

export function TableHeader({
	className,
	...props
}: Readonly<ComponentProps<'thead'>>) {
	return (
		<thead
			className={cn('[&_tr]:border-border [&_tr]:border-b', className)}
			{...props}
		/>
	)
}

export function TableBody({
	className,
	...props
}: Readonly<ComponentProps<'tbody'>>) {
	return (
		<tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
	)
}

export function TableRow({
	className,
	...props
}: Readonly<ComponentProps<'tr'>>) {
	return (
		<tr
			className={cn(
				'border-border border-b transition-colors hover:bg-muted/60',
				className
			)}
			{...props}
		/>
	)
}

export function TableHead({
	className,
	...props
}: Readonly<ComponentProps<'th'>>) {
	return (
		<th
			className={cn(
				'h-12 whitespace-nowrap px-4 text-left align-middle font-semibold text-foreground',
				className
			)}
			{...props}
		/>
	)
}

export function TableCell({
	className,
	...props
}: Readonly<ComponentProps<'td'>>) {
	return (
		<td
			className={cn('px-4 py-3 align-middle text-muted-foreground', className)}
			{...props}
		/>
	)
}

export function TableCaption({
	className,
	...props
}: Readonly<ComponentProps<'caption'>>) {
	return (
		<caption
			className={cn('mt-4 text-muted-foreground text-sm', className)}
			{...props}
		/>
	)
}
