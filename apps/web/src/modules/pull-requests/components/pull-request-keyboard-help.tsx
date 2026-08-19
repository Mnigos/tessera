import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@repo/ui/components/dialog'

interface KeyboardShortcutGroup {
	title: string
	shortcuts: readonly (readonly [keys: string, action: string])[]
}

const SHORTCUT_GROUPS: readonly KeyboardShortcutGroup[] = [
	{
		title: 'Navigation',
		shortcuts: [
			['j / k', 'Next / previous file'],
			['n / p', 'Next / previous unresolved comment'],
			['] / [', 'Next / previous file changed since your review'],
			['⌘K', 'Jump to a file'],
			['⌘F  /', 'Find in this diff'],
		],
	},
	{
		title: 'Line cursor',
		shortcuts: [
			['↓ / ↑', 'Move the line cursor'],
			['⇧J / ⇧K', 'Move the line cursor'],
			['← / →', 'Switch side (split view)'],
			['c', 'Comment on the cursor line'],
			['Esc', 'Cancel the composer'],
		],
	},
	{
		title: 'View',
		shortcuts: [
			['u', 'Unified / split'],
			['w', 'Wrap long lines'],
			['x', 'Collapse / expand this file'],
		],
	},
	{
		title: 'Review',
		shortcuts: [
			['v', 'Toggle viewed on this file'],
			['?', 'This dialog'],
		],
	},
]

interface PullRequestKeyboardHelpProps {
	isOpen: boolean
	onOpenChange: (isOpen: boolean) => void
}

/** Every shortcut the files view answers to, which is the only place they are written down. */
export function PullRequestKeyboardHelp({
	isOpen,
	onOpenChange,
}: Readonly<PullRequestKeyboardHelpProps>) {
	return (
		<Dialog onOpenChange={onOpenChange} open={isOpen}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						Shortcuts are ignored while you are typing. Press Escape to close.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
					{SHORTCUT_GROUPS.map(group => (
						<section key={group.title}>
							<h3 className="mb-2 font-medium text-[0.625rem] text-muted-foreground uppercase tracking-wider">
								{group.title}
							</h3>
							<dl className="flex flex-col gap-1.5">
								{group.shortcuts.map(([keys, action]) => (
									<div className="flex items-center gap-3" key={keys}>
										<dt className="w-20 shrink-0">
											<kbd className="inline-flex h-5 items-center rounded-[4px] border border-border bg-secondary px-1.5 font-mono text-[0.6875rem] text-foreground">
												{keys}
											</kbd>
										</dt>
										<dd className="min-w-0 text-muted-foreground text-xs">
											{action}
										</dd>
									</div>
								))}
							</dl>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	)
}
