interface PullRequestDiffStatsBadgeProps {
	additions: number
	deletions: number
}

export function PullRequestDiffStatsBadge({
	additions,
	deletions,
}: Readonly<PullRequestDiffStatsBadgeProps>) {
	const description = `${additions} additions and ${deletions} deletions`

	return (
		<span
			className="inline-flex shrink-0 items-center gap-1 text-xs"
			title={description}
		>
			<span aria-hidden className="text-emerald-400">
				+{additions}
			</span>
			<span aria-hidden className="text-red-400">
				−{deletions}
			</span>
			<span className="sr-only">{description}</span>
		</span>
	)
}
