import { AnimatePresence, motion } from 'motion/react'
import {
	Children,
	type ElementType,
	isValidElement,
	type PropsWithChildren,
	type ReactNode,
	useState,
} from 'react'

import { Button, type ButtonProps } from './button'

const baseSpanClasses =
	'relative flex items-center justify-center font-semibold gap-2'

function findSlot(children: ReactNode, slot: ElementType) {
	return Children.toArray(children).find(
		child => isValidElement(child) && child.type === slot
	)
}

export interface AnimatedButtonProps
	extends PropsWithChildren<{
			isActive: boolean
			handleActiveClick?: () => void
			handleInactiveClick?: () => void
		}>,
		Omit<ButtonProps, 'onClick' | 'isActive'> {}

export function AnimatedButton({
	children,
	isActive: isActiveProp = false,
	handleActiveClick,
	handleInactiveClick,
	className,
	disabled = false,
	...props
}: Readonly<AnimatedButtonProps>) {
	const activeChild = findSlot(children, AnimatedButtonActive)
	const inactiveChild = findSlot(children, AnimatedButtonInactive)

	const [isActive, setIsActive] = useState(isActiveProp)

	return (
		<AnimatePresence mode="wait">
			<Button
				{...props}
				className={className}
				disabled={disabled}
				onClick={() => {
					if (disabled) return

					if (isActive) handleActiveClick?.()
					else handleInactiveClick?.()

					setIsActive(previous => !previous)
				}}
				variant="outline"
			>
				{isActive ? activeChild : inactiveChild}
			</Button>
		</AnimatePresence>
	)
}

export function AnimatedButtonActive({
	children,
}: Readonly<PropsWithChildren>) {
	return (
		<motion.span
			animate={{ y: 0 }}
			className={baseSpanClasses}
			initial={{ y: -50 }}
			key="active"
		>
			{children}
		</motion.span>
	)
}

export function AnimatedButtonInactive({
	children,
}: Readonly<PropsWithChildren>) {
	return (
		<motion.span
			animate={{ x: 0 }}
			className={baseSpanClasses}
			exit={{ x: 50, transition: { duration: 0.1 } }}
			initial={{ x: 50 }}
			key="inactive"
		>
			{children}
		</motion.span>
	)
}
