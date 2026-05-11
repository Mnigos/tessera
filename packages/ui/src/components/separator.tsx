import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from '@repo/ui/utils'

export function Separator({
	className,
	orientation = 'horizontal',
	...props
}: SeparatorPrimitive.Props) {
	return (
		<SeparatorPrimitive
			className={cn(
				'self-stretch bg-secondary',
				orientation === 'horizontal' && 'mx-auto h-px w-full min-w-4',
				orientation === 'vertical' && 'my-auto h-full min-h-4 w-px',
				className
			)}
			data-slot="separator-root"
			orientation={orientation}
			{...props}
		/>
	)
}
