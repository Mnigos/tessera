import { GitCommitHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

interface RepositoryCommitHistoryShellProps {
	children: ReactNode
	username: string
	slug: string
	refName: string
}

export function RepositoryCommitHistoryShell({
	children,
	username,
	slug,
	refName,
}: Readonly<RepositoryCommitHistoryShellProps>) {
	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-3">
				<div className="min-w-0">
					<p className="truncate text-muted-foreground text-sm">
						{username}/{slug}
					</p>
					<h1 className="font-semibold text-2xl tracking-normal">
						Commit history
					</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
					<GitCommitHorizontal className="size-4" />
					<span className="rounded-md border border-border px-2 py-1 font-mono">
						{refName}
					</span>
				</div>
			</header>
			{children}
		</section>
	)
}
