import { useEffect } from 'react'

export function useMountEffect(effect: () => undefined | (() => void)) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: reusable mount-only effect hook
	useEffect(effect, [])
}
