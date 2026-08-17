import { Button } from '@repo/ui/components/button'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmActionDialog } from './confirm-action-dialog'

describe(ConfirmActionDialog.name, () => {
	test('renders children and pending label', () => {
		render(
			<ConfirmActionDialog
				confirmLabel="Remove member"
				description="This cannot be undone."
				isPending
				onConfirm={vi.fn()}
				onOpenChange={vi.fn()}
				open
				pendingLabel="Removing"
				title="Remove member"
				trigger={<Button>Open</Button>}
			>
				<p>Extra consequence</p>
			</ConfirmActionDialog>
		)

		expect(screen.getByText('Extra consequence')).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Removing' })
				.disabled
		).toBe(true)
	})

	test('keeps the dialog open when confirmation reports an error', async () => {
		const user = userEvent.setup()
		const onOpenChange = vi.fn()

		function ErrorHarness() {
			const [errorMessage, setErrorMessage] = useState<string>()

			return (
				<ConfirmActionDialog
					confirmLabel="Remove member"
					description="This cannot be undone."
					errorMessage={errorMessage}
					isPending={false}
					onConfirm={() => setErrorMessage('Member could not be removed.')}
					onOpenChange={onOpenChange}
					open
					pendingLabel="Removing"
					title="Remove member"
					trigger={<Button>Open</Button>}
				/>
			)
		}

		render(<ErrorHarness />)
		onOpenChange.mockClear()
		await user.click(screen.getByRole('button', { name: 'Remove member' }))

		expect(onOpenChange).not.toHaveBeenCalled()
		expect(screen.getByRole('dialog')).toBeTruthy()
		expect(screen.getByRole('alert').textContent).toContain(
			'Member could not be removed.'
		)
	})
})
