import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

class MockPointerEvent extends Event {
	button: number
	buttons: number
	ctrlKey: boolean
	pointerId: number
	pointerType: string
	shiftKey: boolean

	constructor(type: string, props: PointerEventInit) {
		super(type, props)
		this.button = props.button ?? 0
		this.buttons = props.buttons ?? 0
		this.ctrlKey = props.ctrlKey ?? false
		this.pointerId = props.pointerId ?? 1
		this.pointerType = props.pointerType ?? 'mouse'
		this.shiftKey = props.shiftKey ?? false
	}
}

window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent
Object.defineProperty(navigator, 'clipboard', {
	configurable: true,
	value: {
		writeText: vi.fn(),
	},
})
window.HTMLElement.prototype.scrollIntoView = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})
