import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { cn } from '@repo/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { type ComponentProps, createContext, useContext, useMemo } from 'react'
import { type ToggleVariantProps, toggleVariants } from './toggle.variants'

const ToggleGroupContext = createContext<VariantProps<typeof toggleVariants>>({
	size: 'default',
	variant: 'default',
})

type ToggleGroupProps = ToggleGroupPrimitive.Props & ToggleVariantProps

export function ToggleGroup({
	className,
	variant,
	size,
	children,
	...props
}: Readonly<ToggleGroupProps>) {
	const value = useMemo(() => ({ variant, size }), [variant, size])

	return (
		<ToggleGroupPrimitive
			className={cn(
				'group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:border data-[variant=outline]:border-border data-[variant=outline]:shadow-xs',
				className
			)}
			data-size={size}
			data-slot="toggle-group"
			data-variant={variant}
			{...props}
		>
			<ToggleGroupContext.Provider value={value}>
				{children}
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive>
	)
}

interface ToggleGroupItemProps
	extends ComponentProps<typeof TogglePrimitive>,
		VariantProps<typeof toggleVariants> {}

export function ToggleGroupItem({
	className,
	children,
	variant,
	size,
	...props
}: Readonly<ToggleGroupItemProps>) {
	const context = useContext(ToggleGroupContext)

	return (
		<TogglePrimitive
			className={cn(
				toggleVariants({
					variant: context.variant ?? variant,
					size: context.size ?? size,
				}),
				'min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-0',
				className
			)}
			data-size={context.size ?? size}
			data-slot="toggle-group-item"
			data-variant={context.variant ?? variant}
			{...props}
		>
			{children}
		</TogglePrimitive>
	)
}
