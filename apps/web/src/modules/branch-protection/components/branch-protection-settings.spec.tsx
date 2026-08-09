import { ORPCError } from '@orpc/client'
import { branchProtectionRuleSchema } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useBranchProtectionRulesQuery } from '../hooks/use-branch-protection-rules.query'
import { useDeleteBranchProtectionRuleMutation } from '../hooks/use-delete-branch-protection-rule.mutation'
import { useSaveBranchProtectionRuleMutation } from '../hooks/use-save-branch-protection-rule.mutation'
import { BranchProtectionSettings } from './branch-protection-settings'

vi.mock('../hooks/use-branch-protection-rules.query', () => ({
	useBranchProtectionRulesQuery: vi.fn(),
}))

vi.mock('../hooks/use-save-branch-protection-rule.mutation', () => ({
	useSaveBranchProtectionRuleMutation: vi.fn(),
}))

vi.mock('../hooks/use-delete-branch-protection-rule.mutation', () => ({
	useDeleteBranchProtectionRuleMutation: vi.fn(),
}))

const useBranchProtectionRulesQueryMock = vi.mocked(
	useBranchProtectionRulesQuery
)
const useSaveBranchProtectionRuleMutationMock = vi.mocked(
	useSaveBranchProtectionRuleMutation
)
const useDeleteBranchProtectionRuleMutationMock = vi.mocked(
	useDeleteBranchProtectionRuleMutation
)

const RULE = branchProtectionRuleSchema.parse({
	id: '4d0f1c1e-3f2e-4d1b-9a70-9a3f3d3a1c22',
	targetBranch: 'main',
	requiredApprovals: 2,
	requiredCheckContexts: [{ context: 'build' }],
	requireThreadsResolved: true,
	dismissStaleApprovals: true,
	bypass: { allowed: true, minimumRole: 'owner' },
	version: 3,
	createdAt: new Date('2026-07-11T10:00:00.000Z'),
	updatedAt: new Date('2026-07-11T10:00:00.000Z'),
})

function mockIdleMutation() {
	return {
		mutate: vi.fn(),
		reset: vi.fn(),
		isPending: false,
		isError: false,
		error: null,
	} as never
}

function mockMutations() {
	useSaveBranchProtectionRuleMutationMock.mockReturnValue(mockIdleMutation())
	useDeleteBranchProtectionRuleMutationMock.mockReturnValue(mockIdleMutation())
}

describe(BranchProtectionSettings.name, () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('renders loading, error, forbidden, and empty states', () => {
		mockMutations()
		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: undefined,
			error: null,
			isLoading: true,
			isError: false,
			isSuccess: false,
			refetch: vi.fn(),
		} as never)
		const props = { username: 'marta', slug: 'notes' }
		const { rerender } = render(<BranchProtectionSettings {...props} />)
		expect(document.querySelector('.animate-pulse')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull()

		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: undefined,
			error: new Error('boom'),
			isLoading: false,
			isError: true,
			isSuccess: false,
			refetch: vi.fn(),
		} as never)
		rerender(<BranchProtectionSettings {...props} />)
		expect(
			screen.getByText('Protection rules could not be loaded')
		).toBeTruthy()

		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: undefined,
			error: new ORPCError('FORBIDDEN', { status: 403 }),
			isLoading: false,
			isError: true,
			isSuccess: false,
			refetch: vi.fn(),
		} as never)
		rerender(<BranchProtectionSettings {...props} />)
		expect(screen.getByText('Admin access required')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Create rule' })).toBeNull()

		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: { rules: [], enforced: true },
			error: null,
			isLoading: false,
			isError: false,
			isSuccess: true,
			refetch: vi.fn(),
		} as never)
		rerender(<BranchProtectionSettings {...props} />)
		expect(screen.getByText('No branches are protected yet.')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Create rule' })).toBeTruthy()
	})

	test('submits a new rule with the edited values', async () => {
		mockMutations()
		const saveRule = mockIdleMutation() as {
			mutate: ReturnType<typeof vi.fn>
		}
		useSaveBranchProtectionRuleMutationMock.mockReturnValue(saveRule as never)
		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: { rules: [], enforced: true },
			error: null,
			isLoading: false,
			isError: false,
			isSuccess: true,
			refetch: vi.fn(),
		} as never)
		const user = userEvent.setup()
		render(<BranchProtectionSettings slug="notes" username="marta" />)

		await user.type(screen.getByLabelText('Target branch'), 'main')
		await user.click(screen.getByRole('button', { name: 'Add required check' }))
		await user.type(screen.getByLabelText('Check 1'), 'build')
		const submitButton = screen.getByRole('button', { name: 'Create rule' })
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)
		expect(saveRule.mutate.mock.calls[0]?.[0]).toEqual({
			username: 'marta',
			slug: 'notes',
			targetBranch: 'main',
			requiredApprovals: 1,
			requiredCheckContexts: [
				{ context: 'build', kind: undefined, providerAppId: undefined },
			],
			requireThreadsResolved: false,
			dismissStaleApprovals: true,
			bypass: { allowed: false },
		})
	})

	// The version the dialog holds is the one the card was rendered with, and a
	// conflict means the rule changed since. Deleting what is on screen is no
	// longer what deleting would do, so the way out is the same as for a refused
	// save: read the rules again and decide against what they say now.
	test('offers to reload the rules when a delete hits a version conflict', async () => {
		mockMutations()
		const refetch = vi.fn()

		useDeleteBranchProtectionRuleMutationMock.mockReturnValue({
			mutate: vi.fn(),
			reset: vi.fn(),
			isPending: false,
			isError: true,
			error: new ORPCError('CONFLICT', { status: 409 }),
		} as never)
		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: { rules: [RULE], enforced: true },
			error: null,
			isLoading: false,
			isError: false,
			isSuccess: true,
			refetch,
		} as never)

		const user = userEvent.setup()
		render(<BranchProtectionSettings slug="notes" username="marta" />)

		await user.click(
			screen.getByRole('button', { name: 'Delete protection for main' })
		)
		await user.click(screen.getByRole('button', { name: 'Reload rules' }))

		expect(refetch).toHaveBeenCalledOnce()
	})

	test('saves an existing rule with its version and labels unenforced rules', () => {
		mockMutations()
		const saveRule = mockIdleMutation() as {
			mutate: ReturnType<typeof vi.fn>
		}
		useSaveBranchProtectionRuleMutationMock.mockReturnValue(saveRule as never)
		useBranchProtectionRulesQueryMock.mockReturnValue({
			data: { rules: [RULE], enforced: false },
			error: null,
			isLoading: false,
			isError: false,
			isSuccess: true,
			refetch: vi.fn(),
		} as never)
		render(<BranchProtectionSettings slug="notes" username="marta" />)

		expect(screen.getByText('Rules are inactive')).toBeTruthy()
		expect(
			screen.getByText('Inactive while GitHub is the source of truth')
		).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Delete protection for main' })
		).toBeTruthy()

		const submitButton = screen.getByRole('button', { name: 'Save rule' })
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)
		expect(saveRule.mutate.mock.calls[0]?.[0]).toEqual({
			username: 'marta',
			slug: 'notes',
			targetBranch: 'main',
			requiredApprovals: 2,
			requiredCheckContexts: [
				{ context: 'build', kind: undefined, providerAppId: undefined },
			],
			requireThreadsResolved: true,
			dismissStaleApprovals: true,
			bypass: { allowed: true, minimumRole: 'owner' },
			expectedVersion: 3,
		})
	})
})
