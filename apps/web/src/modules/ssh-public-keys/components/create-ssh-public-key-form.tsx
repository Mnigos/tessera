import type { CreateSshPublicKeyInput } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Plus } from 'lucide-react'
import type { SubmitEvent } from 'react'

import { getCreateSshPublicKeyInput } from '../helpers/ssh-public-key-input'

interface CreateSshPublicKeyFormProps {
	isError: boolean
	isPending: boolean
	onSubmit: (input: CreateSshPublicKeyInput, form: HTMLFormElement) => void
}

export function CreateSshPublicKeyForm({
	isError,
	isPending,
	onSubmit,
}: Readonly<CreateSshPublicKeyFormProps>) {
	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		onSubmit(
			getCreateSshPublicKeyInput(new FormData(event.currentTarget)),
			event.currentTarget
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">Add SSH key</h2>
				<p className="text-muted-foreground text-sm">
					Register a public key for Git access.
				</p>
			</div>
			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="ssh-public-key-title">Title</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="ssh-public-key-title"
						maxLength={100}
						name="title"
						required
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="ssh-public-key">Public key</Label>
					<textarea
						className="min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="ssh-public-key"
						maxLength={8192}
						name="publicKey"
						placeholder="ssh-ed25519 AAAA..."
						required
					/>
				</div>
				{isError && (
					<p className="text-destructive text-sm">
						SSH public key could not be added.
					</p>
				)}
				<Button className="w-full" disabled={isPending} type="submit">
					<Plus className="size-4" />
					{isPending ? 'Adding' : 'Add SSH key'}
				</Button>
			</form>
		</Card>
	)
}
