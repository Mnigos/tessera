import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PullRequestMarkdownEditor } from './pull-request-markdown-editor'

function renderEditor(defaultValue?: string) {
	return render(
		<PullRequestMarkdownEditor
			defaultValue={defaultValue}
			id="pull-request-body"
			label="Description"
			name="body"
			placeholder="optional"
		/>
	)
}

describe('pull request markdown editor', () => {
	test('labels the mode switch and starts on Write', () => {
		renderEditor()

		expect(
			screen.getByRole('tablist', { name: 'Description mode' })
		).toBeTruthy()
		expect(
			screen.getByRole('tab', { name: 'Write' }).getAttribute('aria-selected')
		).toBe('true')
		expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA')
	})

	// Manual activation: the arrow keys move focus along the list and the mode
	// changes only when the focused one is chosen, so arrowing past Preview never
	// swaps the textarea out from under someone tabbing through the form.
	test('moves focus with the arrow keys and switches on Enter', async () => {
		const user = userEvent.setup()
		renderEditor()
		screen.getByRole('tab', { name: 'Write' }).focus()

		await user.keyboard('{ArrowRight}')

		const preview = screen.getByRole('tab', { name: 'Preview' })

		expect(document.activeElement).toBe(preview)
		expect(preview.getAttribute('aria-selected')).toBe('false')

		await user.keyboard('{Enter}')

		expect(preview.getAttribute('aria-selected')).toBe('true')
	})

	// The textarea is the field the surrounding form submits, so previewing must
	// not take it out of the document or lose what was typed into it.
	test('keeps the typed description mounted while previewing', async () => {
		const user = userEvent.setup()
		renderEditor()

		await user.type(screen.getByLabelText('Description'), '# Heading')
		await user.click(screen.getByRole('tab', { name: 'Preview' }))

		expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()
		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Description').value
		).toBe('# Heading')

		await user.click(screen.getByRole('tab', { name: 'Write' }))

		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Description').value
		).toBe('# Heading')
	})

	test('submits the typed description from the preview mode', async () => {
		const user = userEvent.setup()
		const handleSubmit = vi.fn()
		const { container } = render(
			<form
				onSubmit={event => {
					event.preventDefault()
					handleSubmit(String(new FormData(event.currentTarget).get('body')))
				}}
			>
				<PullRequestMarkdownEditor
					id="pull-request-body"
					label="Description"
					name="body"
				/>
			</form>
		)

		await user.type(screen.getByLabelText('Description'), 'From preview')
		await user.click(screen.getByRole('tab', { name: 'Preview' }))

		const form = container.querySelector('form')

		if (!form) throw new Error('The form is missing')

		fireEvent.submit(form)

		expect(handleSubmit).toHaveBeenCalledWith('From preview')
	})

	test('says there is nothing to preview yet for a blank description', async () => {
		const user = userEvent.setup()
		renderEditor('   ')

		await user.click(screen.getByRole('tab', { name: 'Preview' }))

		expect(screen.getByText('Nothing to preview yet.')).toBeTruthy()
	})

	test('previews an existing description without retyping it', async () => {
		const user = userEvent.setup()
		renderEditor('- Existing item')

		await user.click(screen.getByRole('tab', { name: 'Preview' }))

		expect(screen.getByRole('listitem').textContent).toBe('Existing item')
	})

	// The preview renders through the same component every published body goes
	// through, so it drops embedded HTML the same way.
	test('drops embedded HTML from the preview', async () => {
		const user = userEvent.setup()
		const { container } = renderEditor('<script>unsafe()</script>\n\nSafe')

		await user.click(screen.getByRole('tab', { name: 'Preview' }))

		expect(container.querySelector('script')).toBeNull()
		expect(screen.getByText('Safe')).toBeTruthy()
	})
})
