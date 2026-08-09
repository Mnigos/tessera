import type { ChecksSummary, RepositoryCommit } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { RepositoryCommitRows } from './repository-commit-rows'

const EMPTY_COUNTS = {
	queued: 0,
	pending: 0,
	success: 0,
	failure: 0,
	neutral: 0,
	canceled: 0,
	skipped: 0,
	timed_out: 0,
	stale: 0,
}
const ANY_CHECK_REGEX = /check/

const COMMIT: RepositoryCommit = {
	sha: 'a'.repeat(40),
	shortSha: 'aaaaaaa',
	summary: 'Add the ledger',
	signature: { state: 'unsigned' },
}

function summary(overrides: Partial<ChecksSummary> = {}): ChecksSummary {
	return {
		headSha: COMMIT.sha,
		overall: 'failure',
		counts: { ...EMPTY_COUNTS, failure: 1 },
		// History is read against a ref, never against a pull request's head.
		headIsCurrent: false,
		...overrides,
	}
}

describe(RepositoryCommitRows.name, () => {
	test('reads a commit’s rollup out loud beside it', () => {
		render(
			<RepositoryCommitRows
				commits={[{ ...COMMIT, checksSummary: summary() }]}
			/>
		)

		expect(screen.getByText('1 check requires attention')).toBeTruthy()
	})

	test('shows nothing for a commit nothing reported on', () => {
		render(
			<RepositoryCommitRows
				commits={[
					{
						...COMMIT,
						checksSummary: summary({ overall: 'none', counts: EMPTY_COUNTS }),
					},
					{ ...COMMIT, sha: 'b'.repeat(40) },
				]}
			/>
		)

		expect(screen.queryByText(ANY_CHECK_REGEX)).toBeNull()
	})

	test('keeps rendering history that predates any checks at all', () => {
		render(<RepositoryCommitRows commits={[COMMIT]} />)

		expect(screen.getByText('Add the ledger')).toBeTruthy()
	})
})
