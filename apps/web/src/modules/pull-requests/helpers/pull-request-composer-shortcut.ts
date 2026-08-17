import type { KeyboardEvent } from 'react'

/**
 * GitHub's composer shortcut: Command or Control with Enter submits the form
 * the field belongs to. It goes through the form rather than the handler, so a
 * composer whose primary button is spent refuses the shortcut on the same terms.
 */
export function submitPullRequestComposerOnShortcut(
	event: KeyboardEvent<HTMLTextAreaElement>
) {
	if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return

	event.preventDefault()
	event.currentTarget.form?.requestSubmit()
}
