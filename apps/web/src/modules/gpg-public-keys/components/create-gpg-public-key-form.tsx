import type { CreateGpgPublicKeyInput } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Plus } from 'lucide-react'
import type { SubmitEvent } from 'react'

import { getCreateGpgPublicKeyInput } from '../helpers/gpg-public-key-input'

interface CreateGpgPublicKeyFormProps {
	isError: boolean
	isPending: boolean
	onSubmit: (input: CreateGpgPublicKeyInput, form: HTMLFormElement) => void
}

export function CreateGpgPublicKeyForm({
	isError,
	isPending,
	onSubmit,
}: Readonly<CreateGpgPublicKeyFormProps>) {
	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault()
		onSubmit(
			getCreateGpgPublicKeyInput(new FormData(event.currentTarget)),
			event.currentTarget
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">Add GPG key</h2>
				<p className="text-muted-foreground text-sm">
					Register an armored public key for Git signature verification.
				</p>
			</div>
			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="gpg-public-key-title">Title</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="gpg-public-key-title"
						maxLength={100}
						name="title"
						required
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="gpg-public-key">Armored public key</Label>
					<textarea
						className="min-h-40 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="gpg-public-key"
						maxLength={65_536}
						name="publicKey"
						placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
						required
					/>
				</div>
				{isError && (
					<p className="text-destructive text-sm">
						GPG public key could not be added.
					</p>
				)}
				<Button className="w-full" disabled={isPending} type="submit">
					<Plus className="size-4" />
					{isPending ? 'Adding' : 'Add GPG key'}
				</Button>
			</form>
		</Card>
	)
}
