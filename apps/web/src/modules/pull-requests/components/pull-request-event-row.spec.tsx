import type { PullRequestEvent } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { PullRequestEventRow } from './pull-request-event-row'

const createdAt = new Date('2026-08-08T10:00:00.000Z')
const oldSha = `abc1234${'0'.repeat(33)}`
const newSha = `def5678${'0'.repeat(33)}`
describe('pull request event row', () => {
	test.each([
		['head_updated', 'Updated feature from abc1234 to def5678 by marta'],
		['force_pushed', 'Force-pushed feature from abc1234 to def5678 by marta'],
	] as const)('names the branch and both commits of a %s event', (type, description) => {
		const { container } = render(
			<PullRequestEventRow
				event={pushEvent(type, {
					ref: 'refs/heads/feature',
					oldSha,
					newSha,
				})}
			/>
		)

		expect(container.textContent).toContain(description)
		expect(screen.getByTitle(oldSha).textContent).toBe('abc1234')
		expect(screen.getByTitle(newSha).textContent).toBe('def5678')
	})

	test('falls back to the generic label when the movement is unknown', () => {
		render(<PullRequestEventRow event={pushEvent('head_updated')} />)

		expect(screen.getByText('Source branch updated by marta')).toBeTruthy()
	})

	test('names both branches of a retarget', () => {
		const { container } = render(
			<PullRequestEventRow
				event={pushEvent('retargeted', {
					fromBranch: 'main',
					toBranch: 'release',
				})}
			/>
		)

		expect(container.textContent).toContain(
			'Changed the target from main to release by marta'
		)
	})

	// Synchronized history carries no payload of its own.
	test('falls back to the generic label for a retarget without a payload', () => {
		render(<PullRequestEventRow event={pushEvent('retargeted')} />)

		expect(screen.getByText('Pull request retargeted by marta')).toBeTruthy()
	})
})

function pushEvent(
	type: PullRequestEvent['type'],
	payload?: PullRequestEvent['payload']
): PullRequestEvent {
	return {
		id: crypto.randomUUID() as PullRequestEvent['id'],
		pullRequestId: crypto.randomUUID() as PullRequestEvent['pullRequestId'],
		provider: 'tessera',
		actorUsername: 'marta',
		type,
		payload,
		createdAt,
	}
}
