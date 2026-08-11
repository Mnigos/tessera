/**
 * The write boundary, and nothing else.
 *
 * The header badge already says where this pull request came from and links
 * it, so all this has left to do is explain why the comment box and the merge
 * button are missing — that they are a deliberate boundary rather than
 * permissions the viewer is somehow lacking.
 */
export function PullRequestReadOnlyBanner() {
	return (
		<p className="text-muted-foreground text-sm" role="note">
			GitHub owns this pull request. Comments, reviews, and merges happen there
			and appear here once they sync.
		</p>
	)
}
