interface PullRequestGitHubWriteThroughNoteProps {
	/** False for a native pull request frozen by mirroring: it has no GitHub copy. */
	isFromGitHub: boolean
}

/** Attribution, not a boundary: what is typed here reaches GitHub as the reader. */
export function PullRequestGitHubWriteThroughNote({
	isFromGitHub,
}: Readonly<PullRequestGitHubWriteThroughNoteProps>) {
	return (
		<p className="text-muted-foreground text-sm" role="note">
			{isFromGitHub
				? 'GitHub owns this pull request. Anything you post here is sent to GitHub as you.'
				: 'GitHub is the source of truth for this repository; changes you make here are sent to GitHub as you.'}
		</p>
	)
}
