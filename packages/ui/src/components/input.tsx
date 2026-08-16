import { cn } from '@repo/ui/utils'
import type { ComponentPropsWithoutRef } from 'react'

export function Input({
	className,
	...props
}: Readonly<ComponentPropsWithoutRef<'input'>>) {
	return (
		<input
			className={cn(
				'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
				className
			)}
			data-slot="input"
			{...props}
		/>
	)
}
