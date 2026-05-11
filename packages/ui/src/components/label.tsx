import { Field } from '@base-ui/react/field'
import { cn } from '@repo/ui/utils'

export function Label({ className, ...props }: Readonly<Field.Label.Props>) {
	return (
		<Field.Label
			className={cn(
				'flex select-none items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
				className
			)}
			data-slot="label"
			{...props}
		/>
	)
}
