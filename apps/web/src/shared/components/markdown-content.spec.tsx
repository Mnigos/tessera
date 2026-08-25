import { render, screen } from '@testing-library/react'
import { MarkdownContent } from './markdown-content'

/**
 * The renderer is the only thing standing between somebody else's Markdown and
 * the page, and it is used for pull request bodies, comments, review bodies and
 * READMEs alike. These are the properties every one of those sites relies on.
 */
describe('markdown content', () => {
	test('sanitizes embedded HTML instead of rendering it raw', () => {
		const { container } = render(
			<MarkdownContent>
				{
					'<script>unsafe()</script>\n\n<img src="x" onerror="unsafe()">\n\nSafe'
				}
			</MarkdownContent>
		)

		expect(container.querySelector('script')).toBeNull()
		expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull()
		expect(container.innerHTML).not.toContain('onerror')
		expect(screen.getByText('Safe')).toBeTruthy()
	})

	test('keeps a details section collapsed with its summary visible', () => {
		const { container } = render(
			<MarkdownContent>
				{
					'<details>\n<summary>Review details</summary>\n\nHidden findings\n\n</details>'
				}
			</MarkdownContent>
		)

		const details = container.querySelector('details')

		expect(details?.hasAttribute('open')).toBe(false)
		expect(screen.getByText('Review details').tagName).toBe('SUMMARY')
		expect(details?.textContent).toContain('Hidden findings')
	})

	test('never shows HTML comments', () => {
		const { container } = render(
			<MarkdownContent>
				{'<!-- coderabbit-cli-agent-hint:v3 hidden -->\n\nVisible'}
			</MarkdownContent>
		)

		expect(container.textContent).not.toContain('coderabbit-cli-agent-hint')
		expect(screen.getByText('Visible')).toBeTruthy()
	})

	test('renders task lists as unmarked checkbox items', () => {
		const { container } = render(
			<MarkdownContent>{'- [ ] Create stacked PR\n- [x] Done'}</MarkdownContent>
		)

		const checkboxes = container.querySelectorAll('input[type="checkbox"]')

		expect(checkboxes).toHaveLength(2)
		expect((checkboxes[1] as HTMLInputElement).checked).toBe(true)
		for (const item of container.querySelectorAll('li'))
			expect(item.className).toContain('list-none')
	})

	test('renders an escaped HTML tag as text rather than markup', () => {
		const { container } = render(
			<MarkdownContent>{'`<script>alert(1)</script>`'}</MarkdownContent>
		)

		expect(container.querySelector('script')).toBeNull()
		expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
	})

	test.each([
		['javascript:', '[Click](javascript:unsafe())'],
		['data:', '[Click](data:text/html;base64,PHNjcmlwdD4=)'],
		['vbscript:', '[Click](vbscript:unsafe())'],
	])('neutralizes a %s link', (_protocol, markdown) => {
		render(<MarkdownContent>{markdown}</MarkdownContent>)

		const href = screen.getByText('Click').getAttribute('href')

		expect(href === null || href === '').toBeTruthy()
	})

	test('opens external links without handing over the opener', () => {
		render(<MarkdownContent>{'[Docs](https://example.com)'}</MarkdownContent>)

		const link = screen.getByRole('link', { name: 'Docs' })

		expect(link.getAttribute('href')).toBe('https://example.com')
		expect(link.getAttribute('target')).toBe('_blank')
		expect(link.getAttribute('rel')).toBe('noreferrer')
	})

	test('renders GFM tables', () => {
		render(
			<MarkdownContent>
				{'| Branch | Owner |\n| --- | --- |\n| main | marta |'}
			</MarkdownContent>
		)

		expect(screen.getByRole('columnheader', { name: 'Branch' })).toBeTruthy()
		expect(screen.getByRole('cell', { name: 'marta' })).toBeTruthy()
	})

	test('renders lists, headings, quotes and code blocks', () => {
		const { container } = render(
			<MarkdownContent>
				{'# Title\n\n- One\n- Two\n\n> Quoted\n\n```\nconst value = 1\n```'}
			</MarkdownContent>
		)

		expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
		expect(screen.getAllByRole('listitem')).toHaveLength(2)
		expect(container.querySelector('blockquote')?.textContent).toContain(
			'Quoted'
		)
		expect(container.querySelector('pre code')?.textContent).toContain(
			'const value = 1'
		)
	})

	test('renders nothing for an empty body', () => {
		const { container } = render(<MarkdownContent>{''}</MarkdownContent>)

		expect(container.textContent).toBe('')
	})
})
