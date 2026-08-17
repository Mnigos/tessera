import { ConflictError, ServiceUnavailableError } from '~/shared/errors'

export class PullRequestFileViewLimitError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request file views',
			context,
			'Too many files are marked viewed on this commit. Unmark some before marking more.'
		)
	}
}

export class PullRequestHeadUnresolvedError extends ServiceUnavailableError {
	constructor(context?: Record<string, unknown>) {
		super(
			'git storage',
			context,
			"The pull request's current commit couldn't be read. Try again in a moment."
		)
	}
}
