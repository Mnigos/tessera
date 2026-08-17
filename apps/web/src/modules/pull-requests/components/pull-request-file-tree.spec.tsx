import type { PullRequestChangedFile } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullRequestFileTree } from './pull-request-file-tree'

function changedFile(
	path: string,
	overrides: Partial<PullRequestChangedFile> = {}
): PullRequestChangedFile {
	return {
		status: 'modified',
		oldPath: path,
		newPath: path,
		baseBlobId: `base-${path}`,
		headBlobId: `head-${path}`,
		additions: 3,
		deletions: 2,
		isBinary: false,
		...overrides,
	}
}

describe(PullRequestFileTree.name, () => {
	test('renders file metadata, viewed state, and the active row', () => {
		const file = changedFile('src/index.ts')

		render(
			<PullRequestFileTree
				activePath="src/index.ts"
				files={[file]}
				onPrefetch={vi.fn()}
				onSelect={vi.fn()}
				viewedPaths={new Set(['src/index.ts'])}
			/>
		)

		const row = screen.getByTitle('src/index.ts').closest('button')

		expect(row).toBeTruthy()
		expect(row?.getAttribute('aria-current')).toBe('true')
		expect(row?.className).toContain('opacity-60')
		expect(screen.getByText('modified')).toBeTruthy()
		expect(screen.getByText('+3')).toBeTruthy()
		expect(screen.getByText('−2')).toBeTruthy()
		expect(row?.querySelector('svg')).toBeTruthy()
	})

	test('selects a file and prefetches it from pointer and keyboard intent', () => {
		const file = changedFile('src/index.ts')
		const onPrefetch = vi.fn()
		const onSelect = vi.fn()

		render(
			<PullRequestFileTree
				files={[file]}
				onPrefetch={onPrefetch}
				onSelect={onSelect}
			/>
		)

		const row = screen.getByTitle('src/index.ts').closest('button')
		if (!row) throw new Error('File row missing')

		fireEvent.pointerEnter(row)
		fireEvent.focus(row)
		fireEvent.click(row)

		expect(onPrefetch).toHaveBeenCalledTimes(2)
		expect(onPrefetch).toHaveBeenLastCalledWith(file)
		expect(onSelect).toHaveBeenCalledWith('src/index.ts')
	})

	test('collapses and expands folder descendants', async () => {
		const user = userEvent.setup()

		render(
			<PullRequestFileTree
				files={[
					changedFile('src/index.ts'),
					changedFile('src/components/card.tsx'),
				]}
				onPrefetch={vi.fn()}
				onSelect={vi.fn()}
			/>
		)

		const folder = screen.getByRole('button', { name: 'src' })
		expect(screen.getByTitle('src/index.ts')).toBeTruthy()
		expect(screen.getByTitle('src/components/card.tsx')).toBeTruthy()

		await user.click(folder)

		expect(folder.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByTitle('src/index.ts')).toBeNull()
		expect(screen.queryByTitle('src/components/card.tsx')).toBeNull()

		await user.click(folder)

		expect(folder.getAttribute('aria-expanded')).toBe('true')
		expect(screen.getByTitle('src/index.ts')).toBeTruthy()
	})
})
