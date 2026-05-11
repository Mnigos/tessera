import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from '@repo/ui/utils'

export function Progress({
	className,
	value,
	...props
}: Readonly<ProgressPrimitive.Root.Props>) {
	return (
		<ProgressPrimitive.Root
			className={cn(
				'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
				className
			)}
			value={value}
			{...props}
		>
			<ProgressPrimitive.Indicator
				className="h-full w-full flex-1 bg-primary transition-all"
				style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
			/>
		</ProgressPrimitive.Root>
	)
}
