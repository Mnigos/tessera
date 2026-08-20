import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@repo/ui/utils'

export function Popover({ ...props }: Readonly<PopoverPrimitive.Root.Props>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

export function PopoverTrigger({
	...props
}: Readonly<PopoverPrimitive.Trigger.Props>) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

interface PopoverContentProps extends PopoverPrimitive.Popup.Props {
	align?: PopoverPrimitive.Positioner.Props['align']
	side?: PopoverPrimitive.Positioner.Props['side']
	sideOffset?: PopoverPrimitive.Positioner.Props['sideOffset']
}

export function PopoverContent({
	className,
	align = 'center',
	side,
	sideOffset = 4,
	...props
}: Readonly<PopoverContentProps>) {
	return (
		<PopoverPrimitive.Portal>
			{/* The positioner is the placed element, so it is the only one a z-index can lift. */}
			<PopoverPrimitive.Positioner
				align={align}
				className="z-50"
				side={side}
				sideOffset={sideOffset}
			>
				<PopoverPrimitive.Popup
					className={cn(
						'w-fit origin-center rounded-xl border border-border bg-card p-2 text-foreground shadow-sm outline-hidden transition-all duration-150',
						'data-ending-style:scale-95 data-starting-style:scale-95',
						'data-ending-style:opacity-0 data-starting-style:opacity-0',
						className
					)}
					data-slot="popover-content"
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	)
}

export function PopoverAnchor({
	...props
}: Readonly<PopoverPrimitive.Positioner.Props>) {
	return <PopoverPrimitive.Positioner data-slot="popover-anchor" {...props} />
}
