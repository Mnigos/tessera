import type { PullRequestChangedFile } from '@repo/contracts'

/** Changed lines past which a diff waits to be asked for rather than loading with the page. */
const LARGE_FILE_CHANGE_COUNT = 800

type PullRequestFileTreeNode =
	| {
			kind: 'directory'
			name: string
			path: string
			children: PullRequestFileTreeNode[]
	  }
	| { kind: 'file'; name: string; path: string; file: PullRequestChangedFile }

interface PullRequestFileTreeRow {
	node: PullRequestFileTreeNode
	depth: number
}

type FileTreeDraft = Map<string, FileTreeDraft | PullRequestChangedFile>

/** A deleted file has no new path, so its identity is the path it was removed from. */
export function getChangedFilePath(file: PullRequestChangedFile) {
	return file.newPath || file.oldPath
}

export function isLargeChangedFile(file: PullRequestChangedFile) {
	return (
		file.isBinary || file.additions + file.deletions > LARGE_FILE_CHANGE_COUNT
	)
}

export function buildPullRequestFileTree(
	files: readonly PullRequestChangedFile[]
): PullRequestFileTreeNode[] {
	const draft: FileTreeDraft = new Map()

	for (const file of files) {
		const segments = getChangedFilePath(file).split('/')
		const name = segments.pop() ?? ''
		let directory = draft

		for (const segment of segments) {
			// Directories and files are keyed apart so `docs` and `docs/readme.md` can coexist.
			const key = `directory:${segment}`
			const child = directory.get(key)

			if (child instanceof Map) directory = child
			else {
				const nested: FileTreeDraft = new Map()

				directory.set(key, nested)
				directory = nested
			}
		}

		directory.set(`file:${name}`, file)
	}

	return toTreeNodes(draft, '')
}

export function flattenPullRequestFileTree(
	nodes: readonly PullRequestFileTreeNode[],
	collapsedDirectories: readonly string[],
	depth = 0
): PullRequestFileTreeRow[] {
	return nodes.flatMap(node => {
		const row = { node, depth }

		if (node.kind === 'file' || collapsedDirectories.includes(node.path))
			return [row]

		return [
			row,
			...flattenPullRequestFileTree(
				node.children,
				collapsedDirectories,
				depth + 1
			),
		]
	})
}

function toTreeNodes(
	draft: FileTreeDraft,
	parentPath: string
): PullRequestFileTreeNode[] {
	return [...draft].map(([key, child]) => {
		const name = key.slice(key.indexOf(':') + 1)
		const path = parentPath ? `${parentPath}/${name}` : name

		if (!(child instanceof Map))
			return { kind: 'file', name, path, file: child }

		return mergeLoneDirectory({
			kind: 'directory',
			name,
			path,
			children: toTreeNodes(child, path),
		})
	})
}

/** A directory holding nothing but one directory reads better as a single `src/modules` row. */
function mergeLoneDirectory(
	node: Extract<PullRequestFileTreeNode, { kind: 'directory' }>
): PullRequestFileTreeNode {
	const [child] = node.children

	if (node.children.length !== 1 || child?.kind !== 'directory') return node

	return { ...child, name: `${node.name}/${child.name}` }
}
