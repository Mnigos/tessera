import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@repo/ui/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

const avatarVariants = cva(
	'relative flex shrink-0 overflow-hidden rounded-full',
	{
		variants: {
			size: {
				sm: 'size-10',
				md: 'size-12',
				lg: 'size-32',
			},
		},
		defaultVariants: {
			size: 'md',
		},
	}
)

const avatarFallbackVariants = cva(
	'flex size-full items-center justify-center',
	{
		variants: {
			size: {
				sm: 'text-xs',
				md: 'text-2xl',
				lg: 'text-6xl',
			},
		},
		defaultVariants: {
			size: 'md',
		},
	}
)

interface AvatarProps
	extends AvatarPrimitive.Root.Props,
		VariantProps<typeof avatarVariants> {
	displayName: string
	children?: ReactNode
}

export function Avatar({
	displayName,
	children,
	className,
	size = 'md',
	...props
}: Readonly<AvatarProps>) {
	return (
		<AvatarPrimitive.Root
			className={cn(avatarVariants({ size }), className)}
			{...props}
		>
			<AvatarPrimitive.Fallback
				className={cn(
					avatarFallbackVariants({ size }),
					!children && 'bg-muted'
				)}
			>
				{children ?? displayName.slice(0, 1).toUpperCase()}
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	)
}
