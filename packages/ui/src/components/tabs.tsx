import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export const tabsClassName = 'flex flex-col gap-2'
export const tabsListClassName = 'inline-flex h-10 items-center overflow-x-auto'
export const tabsTriggerClassName =
	'not-only:disabled:pointer-events-none inline-flex cursor-pointer items-center justify-center gap-1.5 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:text-primary/50 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60 disabled:hover:text-muted-foreground data-selected:border-primary data-selected:text-primary [&_svg]:size-4 [&_svg]:shrink-0 whitespace-nowrap'

export function Tabs({
	className,
	...props
}: Readonly<TabsPrimitive.Root.Props>) {
	return (
		<TabsPrimitive.Root
			className={cn(tabsClassName, className)}
			data-slot="tabs"
			{...props}
		/>
	)
}

export function TabsList({
	className,
	...props
}: Readonly<TabsPrimitive.List.Props>) {
	return (
		<TabsPrimitive.List
			className={cn(tabsListClassName, className)}
			data-slot="tabs-list"
			{...props}
		/>
	)
}

export function TabsTrigger({
	className,
	...props
}: Readonly<TabsPrimitive.Tab.Props>) {
	return (
		<TabsPrimitive.Tab
			className={cn(tabsTriggerClassName, className)}
			data-slot="tabs-trigger"
			{...props}
		/>
	)
}

export function TabsContent({
	className,
	...props
}: Readonly<TabsPrimitive.Panel.Props & ComponentProps<'div'>>) {
	return (
		<TabsPrimitive.Panel
			className={cn('flex-1 outline-none', className)}
			data-slot="tabs-content"
			{...props}
		/>
	)
}
