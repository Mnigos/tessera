import type { CreatedCheckStatusCredential } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Plus } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { getCheckStatusErrorMessage } from '../helpers/get-check-status-error-message'
import { useCreateCheckStatusProviderMutation } from '../hooks/use-create-check-status-provider.mutation'

const ADD_PROVIDER_ERROR_ID = 'add-check-status-provider-error'

const INPUT_CLASS_NAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60'

interface AddCheckStatusProviderFormProps {
	onCreated: (created: CreatedCheckStatusCredential) => void
	username: string
	slug: string
}

export function AddCheckStatusProviderForm({
	onCreated,
	username,
	slug,
}: Readonly<AddCheckStatusProviderFormProps>) {
	const [key, setKey] = useState('')
	const [displayName, setDisplayName] = useState('')
	const createProvider = useCreateCheckStatusProviderMutation()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const trimmedKey = key.trim()
		const trimmedDisplayName = displayName.trim()

		if (!(trimmedKey && trimmedDisplayName)) return

		createProvider.mutate(
			{ username, slug, key: trimmedKey, displayName: trimmedDisplayName },
			{
				onSuccess: created => {
					setKey('')
					setDisplayName('')
					onCreated(created)
				},
			}
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Add provider
				</h2>
				<p className="text-muted-foreground text-sm">
					Register a CI system and issue it a token for this repository alone.
				</p>
			</div>
			<form
				aria-describedby={
					createProvider.isError ? ADD_PROVIDER_ERROR_ID : undefined
				}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor="check-status-provider-key">Key</Label>
					<input
						className={INPUT_CLASS_NAME}
						disabled={createProvider.isPending}
						id="check-status-provider-key"
						maxLength={64}
						name="key"
						onChange={event => setKey(event.target.value)}
						placeholder="jenkins"
						value={key}
					/>
					<p className="text-muted-foreground text-xs">
						Lowercase letters, numbers and hyphens. Results are filed under it,
						so it never changes.
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="check-status-provider-display-name">Name</Label>
					<input
						className={INPUT_CLASS_NAME}
						disabled={createProvider.isPending}
						id="check-status-provider-display-name"
						maxLength={64}
						name="displayName"
						onChange={event => setDisplayName(event.target.value)}
						placeholder="Jenkins"
						value={displayName}
					/>
				</div>
				{createProvider.isError && (
					<p
						className="text-destructive text-sm"
						id={ADD_PROVIDER_ERROR_ID}
						role="alert"
					>
						{getCheckStatusErrorMessage(
							createProvider.error,
							'Status provider could not be created.'
						)}
					</p>
				)}
				<Button
					className="w-full sm:w-fit"
					disabled={createProvider.isPending}
					type="submit"
				>
					<Plus className="size-4" />
					{createProvider.isPending ? 'Creating' : 'Create provider'}
				</Button>
			</form>
		</Card>
	)
}
