import { ORPCError } from '@orpc/client'
import {
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
	REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { reconnectGitHub } from '@/modules/auth/helpers/reconnect-github'
import { PullRequestErrorMessage } from './pull-request-error-message'

vi.mock('@/modules/auth/helpers/reconnect-github', () => ({
	reconnectGitHub: vi.fn(),
}))

const reconnectGitHubMock = vi.mocked(reconnectGitHub)

describe(PullRequestErrorMessage.name, () => {
	afterEach(() => vi.resetAllMocks())

	test('offers GitHub reconnection and calls the shared helper', async () => {
		reconnectGitHubMock.mockResolvedValue(null)
		const user = userEvent.setup()
		render(
			<PullRequestErrorMessage
				error={error(401, 'UNAUTHORIZED', GITHUB_RECONNECT_REQUIRED_MESSAGE)}
				fallback="The action failed."
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Reconnect GitHub' }))

		expect(reconnectGitHubMock).toHaveBeenCalledOnce()
		expect(screen.getByRole('alert').textContent).toBe(
			GITHUB_RECONNECT_REQUIRED_MESSAGE
		)
	})

	test('reports a failed reconnection below the action', async () => {
		reconnectGitHubMock.mockResolvedValue({ message: 'OAuth refused' } as never)
		const user = userEvent.setup()
		render(
			<PullRequestErrorMessage
				error={error(401, 'UNAUTHORIZED', GITHUB_RECONNECT_REQUIRED_MESSAGE)}
				fallback="The action failed."
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Reconnect GitHub' }))

		expect(
			screen.getByText('GitHub could not be reconnected. Try again.')
		).toBeTruthy()
	})

	test('renders delayed synchronization as a muted status without recovery', () => {
		render(
			<PullRequestErrorMessage
				error={error(409, 'CONFLICT', GITHUB_SYNC_DELAYED_MESSAGE)}
				fallback="The action failed."
				id="write-status"
			/>
		)

		const status = screen.getByRole('status')

		expect(status.textContent).toBe(GITHUB_SYNC_DELAYED_MESSAGE)
		expect(status.className).toContain('text-muted-foreground')
		expect(status.id).toBe('write-status')
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	test.each([
		[403, 'FORBIDDEN', GITHUB_WRITE_FORBIDDEN_MESSAGE],
		[403, 'FORBIDDEN', REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE],
		...Object.values(GITHUB_WRITE_REJECTED_MESSAGES).map(
			message => [409, 'CONFLICT', message] as const
		),
		[429, 'TOO_MANY_REQUESTS', GITHUB_RATE_LIMITED_MESSAGE],
		[502, 'BAD_GATEWAY', GITHUB_UNAVAILABLE_MESSAGE],
	] as const)('renders refusal copy at status %s as an alert without recovery', (status, code, message) => {
		render(
			<PullRequestErrorMessage
				error={error(status, code, message)}
				fallback="The action failed."
			/>
		)

		expect(screen.getByRole('alert').textContent).toBe(message)
		expect(screen.queryByRole('button')).toBeNull()
	})

	test('forwards the message id', () => {
		render(
			<PullRequestErrorMessage
				error={new Error('network')}
				fallback="The action failed."
				id="action-error"
			/>
		)

		expect(screen.getByRole('alert').id).toBe('action-error')
	})
})

function error(status: number, code: string, message: string) {
	return new ORPCError(code, { status, message })
}
