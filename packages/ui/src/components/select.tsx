import { Select as SelectPrimitive } from '@base-ui/react/select'
import { ChevronDown, ChevronUp, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export const Select = SelectPrimitive.Root

export const SelectGroup = SelectPrimitive.Group

export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
	className,
	children,
	...props
}: Readonly<SelectPrimitive.Trigger.Props>) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				'group flex h-9 w-fit min-w-32 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
				className
			)}
			data-slot="select-trigger"
			{...props}
		>
			{children}
			<SelectPrimitive.Icon>
				<HugeiconsIcon
					className="size-4 opacity-50 transition-transform duration-150 group-data-popup-open:rotate-180"
					icon={ChevronDown}
					size={16}
				/>
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}

export function SelectScrollUpButton({
	className,
	...props
}: Readonly<SelectPrimitive.ScrollUpArrow.Props>) {
	return (
		<SelectPrimitive.ScrollUpArrow
			className={cn(
				'flex cursor-default items-center justify-center py-1',
				className
			)}
			data-slot="select-scroll-up-button"
			{...props}
		>
			<HugeiconsIcon className="size-4" icon={ChevronUp} size={16} />
		</SelectPrimitive.ScrollUpArrow>
	)
}

export function SelectScrollDownButton({
	className,
	...props
}: Readonly<SelectPrimitive.ScrollDownArrow.Props>) {
	return (
		<SelectPrimitive.ScrollDownArrow
			className={cn(
				'flex cursor-default items-center justify-center py-1',
				className
			)}
			data-slot="select-scroll-down-button"
			{...props}
		>
			<HugeiconsIcon className="size-4" icon={ChevronDown} size={16} />
		</SelectPrimitive.ScrollDownArrow>
	)
}

interface SelectContentProps extends SelectPrimitive.Popup.Props {
	align?: SelectPrimitive.Positioner.Props['align']
	side?: SelectPrimitive.Positioner.Props['side']
	sideOffset?: SelectPrimitive.Positioner.Props['sideOffset']
	position?: 'popper' | 'item-aligned'
}

export function SelectContent({
	className,
	children,
	align = 'center',
	side,
	sideOffset = 4,
	position = 'popper',
	...props
}: Readonly<SelectContentProps>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				align={align}
				side={side}
				sideOffset={sideOffset}
			>
				<SelectPrimitive.Popup
					className={cn(
						'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-md outline-hidden transition-all duration-150 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0',
						className
					)}
					data-slot="select-content"
					{...props}
				>
					<SelectScrollUpButton data-slot="select-scroll-up-button" />
					<SelectPrimitive.List
						className={cn(
							'max-h-96 overflow-y-auto p-1',
							position === 'popper' && 'w-full min-w-32'
						)}
						data-slot="select-viewport"
					>
						{children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	)
}

export function SelectLabel({
	className,
	...props
}: Readonly<SelectPrimitive.GroupLabel.Props>) {
	return (
		<SelectPrimitive.GroupLabel
			className={cn('px-2 py-1.5 font-semibold text-sm', className)}
			{...props}
		/>
	)
}

export function SelectItem({
	className,
	children,
	...props
}: Readonly<SelectPrimitive.Item.Props>) {
	return (
		<SelectPrimitive.Item
			className={cn(
				'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden data-disabled:pointer-events-none data-highlighted:bg-muted data-highlighted:text-foreground data-disabled:opacity-50',
				className
			)}
			data-slot="select-item"
			{...props}
		>
			<span className="absolute right-2 flex size-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator data-slot="select-item-indicator">
					<HugeiconsIcon className="size-4" icon={Tick02Icon} size={16} />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText data-slot="select-item-text">
				{children}
			</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	)
}

export function SelectSeparator({
	className,
	...props
}: Readonly<ComponentProps<typeof SelectPrimitive.Separator>>) {
	return (
		<SelectPrimitive.Separator
			className={cn('-mx-1 my-1 h-px bg-muted', className)}
			{...props}
		/>
	)
}
