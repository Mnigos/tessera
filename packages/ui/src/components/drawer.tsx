import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { cn } from '@repo/ui/utils'
import type { ComponentProps, ReactNode } from 'react'

export function Drawer({ ...props }: Readonly<DrawerPrimitive.Root.Props>) {
	return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

export function DrawerTrigger({
	...props
}: Readonly<DrawerPrimitive.Trigger.Props>) {
	return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

export function DrawerPortal({
	...props
}: Readonly<DrawerPrimitive.Portal.Props>) {
	return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

export function DrawerClose({
	...props
}: Readonly<DrawerPrimitive.Close.Props>) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

export function DrawerOverlay({
	className,
	...props
}: Readonly<DrawerPrimitive.Backdrop.Props>) {
	return (
		<DrawerPrimitive.Backdrop
			className={cn(
				'fixed inset-0 z-50 bg-background/80 transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0',
				className
			)}
			data-slot="drawer-overlay"
			{...props}
		/>
	)
}

interface DrawerContentProps extends DrawerPrimitive.Popup.Props {
	children: ReactNode
}

export function DrawerContent({
	className,
	children,
	...props
}: Readonly<DrawerContentProps>) {
	return (
		<DrawerPortal>
			<DrawerOverlay />
			<DrawerPrimitive.Viewport className="pointer-events-none fixed inset-0 z-50 flex data-[swipe-direction=up]:items-start data-[swipe-direction=down]:items-end data-[swipe-direction=left]:justify-start data-[swipe-direction=right]:justify-end">
				<DrawerPrimitive.Popup
					className={cn(
						'group/drawer-content pointer-events-auto flex h-auto flex-col border-border bg-card outline-hidden transition-transform duration-300 ease-out',
						'data-[swipe-direction=up]:data-ending-style:-translate-y-full data-[swipe-direction=up]:data-starting-style:-translate-y-full data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:max-h-dvh data-[swipe-direction=up]:w-full data-[swipe-direction=up]:rounded-b-xl data-[swipe-direction=up]:border-b',
						'data-[swipe-direction=down]:data-ending-style:translate-y-full data-[swipe-direction=down]:data-starting-style:translate-y-full data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:max-h-dvh data-[swipe-direction=down]:w-full data-[swipe-direction=down]:rounded-t-xl data-[swipe-direction=down]:border-t',
						'data-[swipe-direction=right]:data-ending-style:translate-x-full data-[swipe-direction=right]:data-starting-style:translate-x-full data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:h-full data-[swipe-direction=right]:w-3/4 data-[swipe-direction=right]:border-l data-[swipe-direction=right]:sm:max-w-sm',
						'data-[swipe-direction=left]:data-ending-style:-translate-x-full data-[swipe-direction=left]:data-starting-style:-translate-x-full data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:h-full data-[swipe-direction=left]:w-3/4 data-[swipe-direction=left]:border-r data-[swipe-direction=left]:sm:max-w-sm',
						className
					)}
					data-slot="drawer-content"
					{...props}
				>
					<DrawerPrimitive.Content className="h-full overflow-y-auto">
						<div className="mx-auto mt-4 hidden h-2 w-25 shrink-0 rounded-full bg-secondary group-data-[swipe-direction=down]/drawer-content:block" />
						{children}
					</DrawerPrimitive.Content>
				</DrawerPrimitive.Popup>
			</DrawerPrimitive.Viewport>
		</DrawerPortal>
	)
}

export function DrawerHeader({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn('flex flex-col gap-1.5 p-4 text-foreground', className)}
			data-slot="drawer-header"
			{...props}
		/>
	)
}

export function DrawerFooter({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn(
				'mt-auto flex flex-col gap-2 p-4 text-foreground',
				className
			)}
			data-slot="drawer-footer"
			{...props}
		/>
	)
}

export function DrawerTitle({
	className,
	...props
}: Readonly<DrawerPrimitive.Title.Props>) {
	return (
		<DrawerPrimitive.Title
			className={cn('font-semibold text-foreground', className)}
			data-slot="drawer-title"
			{...props}
		/>
	)
}

export function DrawerDescription({
	className,
	...props
}: Readonly<DrawerPrimitive.Description.Props>) {
	return (
		<DrawerPrimitive.Description
			className={cn('text-muted-foreground text-sm', className)}
			data-slot="drawer-description"
			{...props}
		/>
	)
}
