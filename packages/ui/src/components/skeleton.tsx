import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div
			className={cn('animate-pulse rounded-md bg-muted', className)}
			data-slot="skeleton"
			{...props}
		/>
	)
}
