const ACTIVITY_SELECTOR = '[data-github-import-activity]'

/** GitHub numeric ids are digits only, so they need no selector escaping. */
export function scrollToGitHubImportActivity(sourceGithubId?: string) {
	if (typeof document === 'undefined') return

	const selector = sourceGithubId
		? `[data-github-import-source="${sourceGithubId}"]`
		: ACTIVITY_SELECTOR

	// The activity card only reaches its importing position on the next paint.
	requestAnimationFrame(() => {
		document
			.querySelector(selector)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	})
}
