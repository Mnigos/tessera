import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

interface RepositoryBrowserBreadcrumbsProps {
	username: string
	slug: string
	refName: string
	path: string
	terminalKind?: 'tree' | 'blob'
}

export function RepositoryBrowserBreadcrumbs({
	username,
	slug,
	refName,
	path,
	terminalKind = 'tree',
}: Readonly<RepositoryBrowserBreadcrumbsProps>) {
	const segments = path.split('/').filter(Boolean)
	const parentSegments =
		terminalKind === 'blob' ? segments.slice(0, -1) : segments
	const terminalName = terminalKind === 'blob' ? segments.at(-1) : undefined

	return (
		<nav
			aria-label="Repository path"
			className="flex min-w-0 flex-wrap items-center gap-1 text-sm"
		>
			<Link
				className="font-medium text-foreground hover:underline"
				to={getRepositoryHref(username, slug)}
			>
				{username}/{slug}
			</Link>
			<CrumbSeparator />
			<Link
				className="font-medium text-foreground hover:underline"
				to={getTreeHref(username, slug, refName, '')}
			>
				{refName}
			</Link>
			{parentSegments.map((segment, index) => {
				const segmentPath = parentSegments.slice(0, index + 1).join('/')

				return (
					<span className="flex min-w-0 items-center gap-1" key={segmentPath}>
						<CrumbSeparator />
						<Link
							className="max-w-40 truncate font-medium text-foreground hover:underline sm:max-w-72"
							to={getTreeHref(username, slug, refName, segmentPath)}
						>
							{segment}
						</Link>
					</span>
				)
			})}
			{terminalName && (
				<span className="flex min-w-0 items-center gap-1">
					<CrumbSeparator />
					<span className="max-w-44 truncate text-muted-foreground sm:max-w-96">
						{terminalName}
					</span>
				</span>
			)}
		</nav>
	)
}

function CrumbSeparator() {
	return (
		<ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
	)
}

export function getRepositoryHref(username: string, slug: string) {
	return `/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
}

export function getTreeHref(
	username: string,
	slug: string,
	refName: string,
	path: string
) {
	const base = `${getRepositoryHref(username, slug)}/tree/${encodeURIComponent(refName)}`
	if (!path) return `${base}/`

	return `${base}/${encodeRepositoryPath(path)}`
}

export function getBlobHref(
	username: string,
	slug: string,
	refName: string,
	path: string
) {
	return `${getRepositoryHref(username, slug)}/blob/${encodeURIComponent(refName)}/${encodeRepositoryPath(path)}`
}

function encodeRepositoryPath(path: string) {
	return path
		.split('/')
		.filter(Boolean)
		.map(segment => encodeURIComponent(segment))
		.join('/')
}
