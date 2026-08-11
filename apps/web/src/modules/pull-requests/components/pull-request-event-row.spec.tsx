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
		const { container } = render(
			<PullRequestEventRow event={pushEvent('head_updated')} />
		)

		expect(container.textContent).toContain('Source branch updated by marta')
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
		const { container } = render(
			<PullRequestEventRow event={pushEvent('retargeted')} />
		)

		expect(container.textContent).toContain('Pull request retargeted by marta')
	})

	test('links a synchronized actor to their GitHub profile with an avatar', () => {
		render(
			<PullRequestEventRow
				event={{
					...pushEvent('closed'),
					provider: 'github',
					actorUsername: 'octocat',
					actor: {
						key: 'MDQ6VXNlcjE=',
						provider: 'github',
						username: 'octocat',
						externalNodeId: 'MDQ6VXNlcjE=',
						avatarUrl: 'https://avatars.githubusercontent.com/u/1',
						htmlUrl: 'https://github.com/octocat',
					},
				}}
			/>
		)

		const link = screen.getByRole('link', { name: 'octocat' })

		expect(link.getAttribute('href')).toBe('https://github.com/octocat')
		expect(link.getAttribute('target')).toBe('_blank')
		expect(link.querySelector('img')?.getAttribute('src')).toBe(
			'https://avatars.githubusercontent.com/u/1'
		)
		// The login is beside it, so the image must not repeat the name.
		expect(link.querySelector('img')?.getAttribute('alt')).toBe('')
	})

	test('names a synchronized actor without a profile as plain text', () => {
		render(
			<PullRequestEventRow
				event={{
					...pushEvent('closed'),
					provider: 'github',
					actorUsername: 'octocat',
					actor: {
						key: 'MDQ6VXNlcjE=',
						provider: 'github',
						username: 'octocat',
						externalNodeId: 'MDQ6VXNlcjE=',
					},
				}}
			/>
		)

		expect(screen.queryByRole('link', { name: 'octocat' })).toBeNull()
		expect(screen.getByText('octocat')).toBeTruthy()
	})

	test('keeps system-authored rows attributed to Tessera', () => {
		const { container } = render(
			<PullRequestEventRow
				event={{ ...pushEvent('queue_paused'), actorUsername: undefined }}
			/>
		)

		expect(container.textContent).toContain('by Tessera')
		expect(container.querySelector('img')).toBeNull()
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
