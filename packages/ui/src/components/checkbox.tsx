import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '@repo/ui/utils'

interface CheckboxProps extends CheckboxPrimitive.Root.Props {}

export function Checkbox({ className, ...props }: Readonly<CheckboxProps>) {
	return (
		<CheckboxPrimitive.Root
			className={cn(
				'peer size-4 shrink-0 rounded border border-input bg-transparent shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary',
				className
			)}
			data-slot="checkbox"
			{...props}
		>
			<CheckboxPrimitive.Indicator
				className={cn('flex items-center justify-center text-white')}
			>
				<HugeiconsIcon className="h-4 w-4" icon={Tick02Icon} size={16} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	)
}
