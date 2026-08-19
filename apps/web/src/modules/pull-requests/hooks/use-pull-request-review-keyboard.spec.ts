import type { PullRequestChangedFile, PullRequestThread } from '@repo/contracts'
import { renderHook } from '@testing-library/react'
import {
	type PullRequestReviewKeyboardOptions,
	toUnresolvedThreadStops,
	usePullRequestReviewKeyboard,
} from './use-pull-request-review-keyboard'

function changedFile(path: string): PullRequestChangedFile {
	return {
		status: 'modified',
		oldPath: path,
		newPath: path,
		baseBlobId: `base-${path}`,
		headBlobId: `head-${path}`,
		additions: 1,
		deletions: 1,
		isBinary: false,
	}
}

function thread(
	id: string,
	path: string,
	endLine: number,
	isResolved = false
): PullRequestThread {
	return {
		id: id as PullRequestThread['id'],
		kind: 'inline',
		currentAnchor: { path, side: 'right', startLine: endLine, endLine },
		outdated: false,
		createdAt: new Date(),
		comments: [],
		resolved: isResolved
			? {
					at: new Date(),
					by: {
						key: 'tessera:marta',
						provider: 'tessera',
						username: 'marta',
					},
				}
			: undefined,
	}
}

const FILES = [changedFile('src/a.ts'), changedFile('src/b.ts')]

function renderKeyboard(
	overrides: Partial<PullRequestReviewKeyboardOptions> = {}
) {
	const options: PullRequestReviewKeyboardOptions = {
		files: FILES,
		threads: [],
		activePath: 'src/a.ts',
		changedSincePaths: new Set(),
		canMarkViewed: true,
		isFileViewed: () => false,
		isFileExpanded: () => true,
		onJumpToFile: vi.fn(),
		onRevealJump: vi.fn(),
		onToggleViewed: vi.fn(),
		onToggleExpanded: vi.fn(),
		onOpenOverlay: vi.fn(),
		...overrides,
	}

	renderHook(() => usePullRequestReviewKeyboard(options))

	return options
}

function press(key: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	})

	window.dispatchEvent(event)

	return event
}

describe(usePullRequestReviewKeyboard.name, () => {
	afterEach(() => {
		document.body.innerHTML = ''
	})

	test('walks the files with j and k', () => {
		const options = renderKeyboard()

		press('j')
		expect(options.onJumpToFile).toHaveBeenCalledWith('src/b.ts')

		press('k')
		expect(options.onJumpToFile).toHaveBeenCalledTimes(1)
	})

	test('holds the last file rather than wrapping past it', () => {
		const options = renderKeyboard({ activePath: 'src/b.ts' })

		press('j')
		expect(options.onJumpToFile).not.toHaveBeenCalled()
	})

	test('toggles viewed and collapse on the active file', () => {
		const options = renderKeyboard({ isFileExpanded: () => true })

		press('v')
		expect(options.onToggleViewed).toHaveBeenCalledWith('src/a.ts', true)

		press('x')
		expect(options.onToggleExpanded).toHaveBeenCalledWith('src/a.ts', false)
	})

	test('leaves viewed alone when the state is unknown', () => {
		const options = renderKeyboard({ canMarkViewed: false })

		press('v')
		expect(options.onToggleViewed).not.toHaveBeenCalled()
	})

	test('reveals unresolved threads in comparison order', () => {
		const options = renderKeyboard({
			threads: [
				thread('t-b', 'src/b.ts', 4),
				thread('t-resolved', 'src/a.ts', 1, true),
				thread('t-a', 'src/a.ts', 9),
			],
		})

		press('n')
		expect(options.onRevealJump).toHaveBeenCalledWith({
			kind: 'thread',
			path: 'src/a.ts',
			threadId: 't-a',
		})

		press('n')
		expect(options.onRevealJump).toHaveBeenLastCalledWith({
			kind: 'thread',
			path: 'src/b.ts',
			threadId: 't-b',
		})
	})

	test('falls back to the next file when nothing changed since the review', () => {
		const options = renderKeyboard()

		press(']')
		expect(options.onJumpToFile).toHaveBeenCalledWith('src/b.ts')
	})

	test('walks only the changed files when there are any', () => {
		const options = renderKeyboard({
			activePath: 'src/a.ts',
			changedSincePaths: new Set(['src/b.ts']),
		})

		press(']')
		expect(options.onJumpToFile).toHaveBeenCalledWith('src/b.ts')
	})

	test('opens the overlays from their keys and chords', () => {
		const options = renderKeyboard()

		press('?')
		press('/')
		press('k', { metaKey: true })
		press('f', { ctrlKey: true })

		expect(options.onOpenOverlay).toHaveBeenNthCalledWith(1, 'help')
		expect(options.onOpenOverlay).toHaveBeenNthCalledWith(2, 'find')
		expect(options.onOpenOverlay).toHaveBeenNthCalledWith(3, 'jump')
		expect(options.onOpenOverlay).toHaveBeenNthCalledWith(4, 'find')
	})

	test('ignores keys typed into a field, including the find chord', () => {
		const options = renderKeyboard()
		const textarea = document.createElement('textarea')

		document.body.append(textarea)
		textarea.focus()
		textarea.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'j', bubbles: true })
		)
		textarea.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'f',
				metaKey: true,
				bubbles: true,
				cancelable: true,
			})
		)

		expect(options.onJumpToFile).not.toHaveBeenCalled()
		expect(options.onOpenOverlay).not.toHaveBeenCalled()
	})

	test('stands down while a dialog is up', () => {
		const options = renderKeyboard()
		const dialog = document.createElement('div')

		dialog.dataset.slot = 'dialog-content'
		dialog.dataset.open = ''
		document.body.append(dialog)
		press('j')

		expect(options.onJumpToFile).not.toHaveBeenCalled()
	})

	test('claims the keys it handles and no others', () => {
		renderKeyboard()

		expect(press('j').defaultPrevented).toBe(true)
		expect(press('z').defaultPrevented).toBe(false)
	})

	test('moves the line cursor within the active file', () => {
		renderKeyboard()

		document.body.innerHTML = `
			<div data-file-path="src/a.ts">
				<span data-side="right" data-line="1"><button type="button"></button></span>
				<span data-side="right" data-line="2"><button type="button"></button></span>
			</div>
		`

		press('ArrowDown')
		expect(
			document.querySelector('[data-cursor]')?.getAttribute('data-line')
		).toBe('1')

		press('ArrowDown')
		expect(
			document.querySelector('[data-cursor]')?.getAttribute('data-line')
		).toBe('2')
	})

	test('c opens the composer on the cursor line', () => {
		renderKeyboard()

		document.body.innerHTML = `
			<div data-file-path="src/a.ts">
				<span data-side="right" data-line="1"><button type="button"></button></span>
			</div>
		`

		const button = document.querySelector('button')
		const onClick = vi.fn()

		button?.addEventListener('click', onClick)
		press('c')

		expect(onClick).toHaveBeenCalledTimes(1)
	})
})

describe(toUnresolvedThreadStops.name, () => {
	test('drops resolved and unplaced threads', () => {
		const unplaced = thread('t-gone', 'src/a.ts', 1)

		expect(
			toUnresolvedThreadStops(FILES, [
				{ ...unplaced, currentAnchor: undefined },
				thread('t-done', 'src/a.ts', 2, true),
				thread('t-live', 'src/a.ts', 3),
			])
		).toEqual([{ id: 't-live', path: 'src/a.ts', line: 3 }])
	})
})
