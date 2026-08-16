import { Button } from '@repo/ui/components/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui/components/dialog'
import type { ReactElement, ReactNode } from 'react'

interface ConfirmActionDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	trigger: ReactElement
	title: ReactNode
	description: ReactNode
	confirmLabel: string
	pendingLabel: string
	cancelLabel?: string
	isPending: boolean
	disabled?: boolean
	errorMessage?: string
	onConfirm: () => void
	children?: ReactNode
}

/** Stays open on failure: the reason is usually something to go and act on. */
export function ConfirmActionDialog({
	cancelLabel = 'Cancel',
	children,
	confirmLabel,
	description,
	disabled = false,
	errorMessage,
	isPending,
	onConfirm,
	onOpenChange,
	open,
	pendingLabel,
	title,
	trigger,
}: Readonly<ConfirmActionDialogProps>) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
				{errorMessage && (
					<p className="text-destructive text-sm" role="alert">
						{errorMessage}
					</p>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="secondary" />}>
						{cancelLabel}
					</DialogClose>
					<Button
						disabled={disabled || isPending}
						onClick={onConfirm}
						variant="destructive"
					>
						{isPending ? pendingLabel : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
