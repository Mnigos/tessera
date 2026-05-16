import type { RepositoryCommit } from '@repo/contracts'

type RepositoryCommitIdentity = RepositoryCommit['author']

/**
 * Formats a Git commit identity for compact commit history metadata.
 */
export function formatRepositoryCommitIdentity(
	identity: RepositoryCommitIdentity
) {
	const name = identity?.name?.trim()
	const email = identity?.email?.trim()

	if (name && email) return `${name} <${email}>`
	if (name) return name
	if (email) return email

	return 'Unknown'
}

/**
 * Formats a Git commit timestamp in UTC so server and client rendering stay stable.
 */
export function formatRepositoryCommitDate(date: string) {
	const parsedDate = new Date(date)
	if (Number.isNaN(parsedDate.getTime())) return date

	return new Intl.DateTimeFormat('en', {
		dateStyle: 'medium',
		timeZone: 'UTC',
		timeStyle: 'short',
	}).format(parsedDate)
}

/**
 * Converts a Git commit timestamp to the ISO value used by time elements.
 */
export function formatRepositoryCommitDateTime(date: string) {
	const parsedDate = new Date(date)
	if (Number.isNaN(parsedDate.getTime())) return date

	return parsedDate.toISOString()
}

/**
 * Checks whether committer metadata is meaningfully different from author metadata.
 */
export function hasDifferentRepositoryCommitter(commit: RepositoryCommit) {
	const author = commit.author
	const committer = commit.committer

	if (!committer) return false
	if (!author) return true

	return (
		author.name !== committer.name ||
		author.email !== committer.email ||
		repositoryCommitDatesDiffer(author.date, committer.date)
	)
}

function repositoryCommitDatesDiffer(
	authorDate: string,
	committerDate: string
) {
	if (!(authorDate || committerDate)) return false
	if (!(authorDate && committerDate)) return true

	return new Date(authorDate).getTime() !== new Date(committerDate).getTime()
}
