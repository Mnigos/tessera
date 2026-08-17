import { ORPCError } from '@orpc/client'
import {
	GITHUB_SYNC_DELAYED_MESSAGE,
	type PullRequest,
	pullRequestSchema,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRepositoryRefsQuery } from '@/modules/repositories/hooks/use-repository-refs.query'
import { useRetargetPullRequestMutation } from '../hooks/use-retarget-pull-request.mutation'
import { PullRequestRetargetDialog } from './pull-request-retarget-dialog'

const CHANGE_TARGET_TRIGGER = 'Change target'

vi.mock('@/modules/repositories/hooks/use-repository-refs.query', () => ({
	useRepositoryRefsQuery: vi.fn(),
}))

vi.mock('../hooks/use-retarget-pull-request.mutation', () => ({
	useRetargetPullRequestMutation: vi.fn(),
}))

const useRepositoryRefsQueryMock = vi.mocked(useRepositoryRefsQuery)
const useRetargetPullRequestMutationMock = vi.mocked(
	useRetargetPullRequestMutation
)

const PULL_REQUEST: PullRequest = pullRequestSchema.parse({
	id: 'd8101d74-b320-4482-a8f2-a25308fb2757',
	repositoryId: '8426d960-d537-4bc9-9ec9-43e8acd632b0',
	provider: 'tessera',
	number: 4,
	authorUserId: '479a0ef2-aed6-48cd-9511-bb39a86a3ba5',
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'a'.repeat(40),
	openingHeadSha: 'b'.repeat(40),
	title: 'Add feature',
	body: '',
	state: 'open',
	createdAt: '2026-08-08T10:00:00.000Z',
	updatedAt: '2026-08-08T10:00:00.000Z',
})

function branch(name: string) {
	return {
		type: 'branch' as const,
		name,
		qualifiedName: `refs/heads/${name}`,
		target: `${name}-sha`,
	}
}

function renderDialog() {
	return render(
		<PullRequestRetargetDialog
			pullRequest={PULL_REQUEST}
			slug="notes"
			username="marta"
		/>
	)
}

describe('pull request retarget dialog', () => {
	const mutate = vi.fn()
	const reset = vi.fn()

	beforeEach(() => {
		useRepositoryRefsQueryMock.mockReturnValue({
			data: {
				branches: [branch('main'), branch('feature'), branch('release')],
			},
			isError: false,
		} as never)
		useRetargetPullRequestMutationMock.mockReturnValue({
			mutate,
			reset,
			isError: false,
			isPending: false,
			error: undefined,
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('opens on the target the pull request currently has', async () => {
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)

		expect(
			screen.getByRole('combobox', { name: 'Target branch' }).textContent
		).toContain('main')
	})

	// The source is what the pull request is; offering it would let somebody
	// build a pull request from a branch to itself.
	test('does not offer the pull request’s own source branch', async () => {
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)
		await user.click(screen.getByRole('combobox', { name: 'Target branch' }))

		expect(screen.getByRole('option', { name: 'release' })).toBeTruthy()
		expect(screen.queryByRole('option', { name: 'feature' })).toBeNull()
	})

	test('asks for nothing until a different branch is chosen', async () => {
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)

		const confirm = screen.getByRole('button', { name: 'Change target branch' })

		expect(confirm.hasAttribute('disabled')).toBeTruthy()

		await user.click(screen.getByRole('combobox', { name: 'Target branch' }))
		await user.click(screen.getByRole('option', { name: 'release' }))
		await user.click(
			screen.getByRole('button', { name: 'Change target branch' })
		)

		expect(mutate).toHaveBeenCalledWith(
			{ username: 'marta', slug: 'notes', number: 4, targetBranch: 'release' },
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
	})

	test('surfaces the server’s refusal', async () => {
		useRetargetPullRequestMutationMock.mockReturnValue({
			mutate,
			reset,
			isError: true,
			isPending: false,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: 'Leave the merge queue before changing the target branch.',
			}),
		} as never)
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)

		expect(
			screen.getByText(
				'Leave the merge queue before changing the target branch.'
			)
		).toBeTruthy()
	})

	test('keeps an idempotent retarget retryable after delayed synchronization', async () => {
		useRetargetPullRequestMutationMock.mockReturnValue({
			mutate,
			reset,
			isError: true,
			isPending: false,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
		} as never)
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)
		await user.click(screen.getByRole('combobox', { name: 'Target branch' }))
		await user.click(screen.getByRole('option', { name: 'release' }))

		expect(screen.getByRole('status').textContent).toBe(
			GITHUB_SYNC_DELAYED_MESSAGE
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Change target branch',
			}).disabled
		).toBeFalsy()
		await user.click(
			screen.getByRole('button', { name: 'Change target branch' })
		)
		expect(mutate).toHaveBeenCalledWith(
			{ username: 'marta', slug: 'notes', number: 4, targetBranch: 'release' },
			expect.anything()
		)
	})

	test('reports branches that could not be loaded', async () => {
		useRepositoryRefsQueryMock.mockReturnValue({
			data: undefined,
			isError: true,
		} as never)
		const user = userEvent.setup()
		renderDialog()

		await user.click(
			screen.getByRole('button', { name: CHANGE_TARGET_TRIGGER })
		)

		expect(
			screen.getByText('The repository branches could not be loaded.')
		).toBeTruthy()
		expect(
			screen
				.getByRole('button', { name: 'Change target branch' })
				.hasAttribute('disabled')
		).toBeTruthy()
	})
})
