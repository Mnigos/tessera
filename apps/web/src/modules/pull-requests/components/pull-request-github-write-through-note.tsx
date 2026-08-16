interface PullRequestReadOnlyBannerProps {
	/**
	 * Whether this pull request came from GitHub. A repository can be mirrored
	 * after native pull requests already exist in it, and those have no GitHub
	 * counterpart to send anybody to.
	 */
	isFromGitHub: boolean
}

/**
 * The write boundary, and nothing else.
 *
 * The header badge already says where a synchronized pull request came from and
 * links it, so all this has left to do is explain why the comment box and the
 * merge button are missing — that they are a deliberate boundary rather than
 * permissions the viewer is somehow lacking.
 *
 * A native pull request frozen by its repository being mirrored gets the same
 * boundary without the destination: telling its author to go and comment on
 * GitHub would send them looking for a pull request that does not exist there.
 */
export function PullRequestReadOnlyBanner({
	isFromGitHub,
}: Readonly<PullRequestReadOnlyBannerProps>) {
	return (
		<p className="text-muted-foreground text-sm" role="note">
			{isFromGitHub
				? 'GitHub owns this pull request. Comments, reviews, and merges happen there and appear here once they sync.'
				: 'GitHub is the source of truth for this repository, so Tessera accepts no changes to this pull request.'}
		</p>
	)
}
