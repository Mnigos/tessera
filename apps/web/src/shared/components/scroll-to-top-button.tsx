'use client'

import { Button } from '@repo/ui/components/button'
import { ArrowUp } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useSyncExternalStore } from 'react'

/** Roughly a viewport down — any less and the button flickers in during normal reading. */
const SHOW_AFTER_PX = 800

function subscribe(onChange: () => void) {
	window.addEventListener('scroll', onChange, { passive: true })

	return () => window.removeEventListener('scroll', onChange)
}

function getIsScrolledDown() {
	return window.scrollY > SHOW_AFTER_PX
}

function getServerSnapshot() {
	return false
}

/** Floats in once the page is a viewport deep and puts the reader back on top. */
export function ScrollToTopButton() {
	const isVisible = useSyncExternalStore(
		subscribe,
		getIsScrolledDown,
		getServerSnapshot
	)
	const shouldReduceMotion = useReducedMotion()

	if (!isVisible) return null

	return (
		<Button
			aria-label="Scroll to top"
			className="fixed right-6 bottom-6 z-40 size-10 rounded-full border border-border bg-card/95 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
			onClick={() =>
				window.scrollTo({
					top: 0,
					behavior: shouldReduceMotion ? 'auto' : 'smooth',
				})
			}
			size="icon"
			variant="ghost"
		>
			<ArrowUp className="size-5" />
		</Button>
	)
}
