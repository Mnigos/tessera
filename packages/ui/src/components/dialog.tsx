import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Close } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '@repo/ui/utils'
import type { ComponentProps, PropsWithChildren } from 'react'

export function Dialog({ ...props }: Readonly<DialogPrimitive.Root.Props>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

export function DialogTrigger({
	...props
}: Readonly<DialogPrimitive.Trigger.Props>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

export function DialogPortal({
	...props
}: Readonly<DialogPrimitive.Portal.Props>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

export function DialogClose({
	...props
}: Readonly<DialogPrimitive.Close.Props>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

export function DialogOverlay({
	className,
	...props
}: Readonly<DialogPrimitive.Backdrop.Props>) {
	return (
		<DialogPrimitive.Backdrop
			className={cn(
				'fixed inset-0 z-50 bg-background/80 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
				className
			)}
			data-slot="dialog-overlay"
			{...props}
		/>
	)
}

export function DialogContent({
	className,
	children,
	...props
}: Readonly<PropsWithChildren<DialogPrimitive.Popup.Props>>) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Popup
				className={cn(
					'fixed top-1/2 right-4 left-4 z-50 grid -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 text-foreground shadow-lg outline-hidden transition-all duration-200 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 sm:right-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2',
					className
				)}
				data-slot="dialog-content"
				{...props}
			>
				{children}
				<DialogPrimitive.Close className="absolute top-4 right-4 cursor-pointer rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0">
					<HugeiconsIcon className="size-4" icon={Close} size={16} />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Popup>
		</DialogPortal>
	)
}

export function DialogHeader({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
			data-slot="dialog-header"
			{...props}
		/>
	)
}

export function DialogFooter({
	className,
	...props
}: Readonly<ComponentProps<'div'>>) {
	return (
		<div
			className={cn(
				'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
				className
			)}
			data-slot="dialog-footer"
			{...props}
		/>
	)
}

export function DialogTitle({
	className,
	...props
}: Readonly<DialogPrimitive.Title.Props>) {
	return (
		<DialogPrimitive.Title
			className={cn('font-semibold text-lg leading-none', className)}
			data-slot="dialog-title"
			{...props}
		/>
	)
}

export function DialogDescription({
	className,
	...props
}: Readonly<DialogPrimitive.Description.Props>) {
	return (
		<DialogPrimitive.Description
			className={cn('text-muted-foreground text-sm', className)}
			data-slot="dialog-description"
			{...props}
		/>
	)
}
