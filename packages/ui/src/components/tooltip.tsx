import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@repo/ui/utils'

export function Tooltip(props: Readonly<TooltipPrimitive.Root.Props>) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	)
}

export function TooltipTrigger(
	props: Readonly<TooltipPrimitive.Trigger.Props>
) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

interface TooltipContentProps extends TooltipPrimitive.Popup.Props {
	align?: TooltipPrimitive.Positioner.Props['align']
	side?: TooltipPrimitive.Positioner.Props['side']
	sideOffset?: TooltipPrimitive.Positioner.Props['sideOffset']
}

export function TooltipContent({
	className,
	align = 'center',
	side,
	sideOffset = 4,
	children,
	...props
}: Readonly<TooltipContentProps>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				side={side}
				sideOffset={sideOffset}
			>
				<TooltipPrimitive.Popup
					className={cn(
						'z-50 origin-center overflow-hidden rounded-md bg-card px-3 py-1.5 text-foreground text-xs transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0',
						className
					)}
					data-slot="tooltip-content"
					{...props}
				>
					{children}
					<TooltipPrimitive.Arrow className="z-50 size-2.5 rotate-45 rounded-xs bg-card fill-popover" />
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	)
}

export function TooltipProvider(
	props: Readonly<TooltipPrimitive.Provider.Props>
) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />
}
