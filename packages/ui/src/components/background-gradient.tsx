import { motion } from 'motion/react'
import type { PropsWithChildren } from 'react'

import { cn } from '../utils'

interface BackgroundGradientProps
	extends PropsWithChildren<{
		className?: string
		containerClassName?: string
		animate?: boolean
	}> {}

export function BackgroundGradient({
	children,
	className,
	containerClassName,
	animate = true,
}: Readonly<BackgroundGradientProps>) {
	const variants = {
		initial: {
			backgroundPosition: '0 50%',
		},
		animate: {
			backgroundPosition: ['0, 50%', '100% 50%', '0 50%'],
		},
	}

	return (
		<div className={cn('group relative p-1', containerClassName)}>
			<motion.div
				animate={animate ? 'animate' : undefined}
				className={cn(
					'absolute inset-0 z-1 rounded-xl opacity-60 blur-xl transition duration-500 will-change-transform group-hover:opacity-100',
					'bg-[radial-gradient(circle_farthest-side_at_0_100%,var(--color-primary),transparent),radial-gradient(circle_farthest-side_at_100%_0,var(--color-chart-1),transparent),radial-gradient(circle_farthest-side_at_100%_100%,var(--color-accent),transparent),radial-gradient(circle_farthest-side_at_0_0,var(--color-chart-3),var(--color-chart-5))]'
				)}
				initial={animate ? 'initial' : undefined}
				style={{
					backgroundSize: animate ? '400% 400%' : undefined,
				}}
				transition={
					animate
						? {
								duration: 5,
								repeat: Number.POSITIVE_INFINITY,
								repeatType: 'reverse',
							}
						: undefined
				}
				variants={animate ? variants : undefined}
			/>

			<motion.div
				animate={animate ? 'animate' : undefined}
				className={cn(
					'absolute inset-0 z-1 rounded-xl will-change-transform',
					'bg-[radial-gradient(circle_farthest-side_at_0_100%,var(--color-primary),transparent),radial-gradient(circle_farthest-side_at_100%_0,var(--color-chart-1),transparent),radial-gradient(circle_farthest-side_at_100%_100%,var(--color-accent),transparent),radial-gradient(circle_farthest-side_at_0_0,var(--color-chart-3),var(--color-chart-5))]'
				)}
				initial={animate ? 'initial' : undefined}
				style={{
					backgroundSize: animate ? '400% 400%' : undefined,
				}}
				transition={
					animate
						? {
								duration: 5,
								repeat: Number.POSITIVE_INFINITY,
								repeatType: 'reverse',
							}
						: undefined
				}
				variants={animate ? variants : undefined}
			/>

			<div className={cn('relative z-10', className)}>{children}</div>
		</div>
	)
}
