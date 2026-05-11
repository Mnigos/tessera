import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { cn } from '@repo/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { toggleVariants } from './toggle.variants'

interface ToggleProps
	extends TogglePrimitive.Props,
		VariantProps<typeof toggleVariants> {}

export function Toggle({
	className,
	variant,
	size,
	...props
}: Readonly<ToggleProps>) {
	return (
		<TogglePrimitive
			className={cn(toggleVariants({ variant, size, className }))}
			data-slot="toggle"
			{...props}
		/>
	)
}
