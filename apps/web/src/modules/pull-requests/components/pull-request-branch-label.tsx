interface PullRequestBranchLabelProps {
	name: string
}

/**
 * A branch name in the pull request header. Long names truncate rather than
 * pushing the rest of the metadata row off the line, so the full value stays
 * reachable through the title.
 */
export function PullRequestBranchLabel({
	name,
}: Readonly<PullRequestBranchLabelProps>) {
	return (
		<span
			className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs sm:max-w-64"
			title={name}
		>
			{name}
		</span>
	)
}
