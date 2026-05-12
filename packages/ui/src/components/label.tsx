import { cn } from '@repo/ui/utils'
import type { ComponentPropsWithoutRef } from 'react'

interface LabelProps extends ComponentPropsWithoutRef<'label'> {
	htmlFor: string
}

export function Label({
	children,
	className,
	htmlFor,
	...props
}: Readonly<LabelProps>) {
	return (
		<label
			className={cn(
				'flex select-none items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
				className
			)}
			data-slot="label"
			htmlFor={htmlFor}
			{...props}
		>
			{children}
		</label>
	)
}
