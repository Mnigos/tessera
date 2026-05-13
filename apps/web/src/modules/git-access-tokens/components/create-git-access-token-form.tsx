import type { CreateGitAccessTokenInput } from '@repo/contracts'
import { gitAccessTokenPermissions } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Plus } from 'lucide-react'
import type { ComponentProps } from 'react'
import { getCreateGitAccessTokenInput } from '../helpers/git-access-token-input'

interface CreateGitAccessTokenFormProps {
	createdToken?: string
	isError: boolean
	isPending: boolean
	onPermissionsError: () => void
	onSubmit: (input: CreateGitAccessTokenInput, form: HTMLFormElement) => void
	permissionsError: boolean
}

export function CreateGitAccessTokenForm({
	createdToken,
	isError,
	isPending,
	onPermissionsError,
	onSubmit,
	permissionsError,
}: Readonly<CreateGitAccessTokenFormProps>) {
	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const input = getCreateGitAccessTokenInput(
			new FormData(event.currentTarget)
		)
		if (!input) {
			onPermissionsError()
			return
		}

		onSubmit(input, event.currentTarget)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Create Git token
				</h2>
				<p className="text-muted-foreground text-sm">
					Generate a token for Git over HTTPS.
				</p>
			</div>
			{createdToken && (
				<div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
					<p className="font-medium text-sm">New token</p>
					<code className="break-all rounded bg-background px-2 py-1 text-xs">
						{createdToken}
					</code>
				</div>
			)}
			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="git-token-name">Name</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="git-token-name"
						maxLength={64}
						name="name"
						placeholder="optional"
					/>
				</div>
				<fieldset className="flex flex-col gap-2">
					<legend className="font-medium text-sm">Permissions</legend>
					{gitAccessTokenPermissions.map(permission => (
						<label
							className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
							key={permission}
						>
							<input
								className="accent-primary"
								defaultChecked={permission === 'git:read'}
								name="permissions"
								type="checkbox"
								value={permission}
							/>
							{permission}
						</label>
					))}
				</fieldset>
				{permissionsError && (
					<p className="text-destructive text-sm">
						Select at least one permission.
					</p>
				)}
				{isError && (
					<p className="text-destructive text-sm">
						Git token could not be created.
					</p>
				)}
				<Button className="w-full" disabled={isPending} type="submit">
					<Plus className="size-4" />
					{isPending ? 'Creating' : 'Create token'}
				</Button>
			</form>
		</Card>
	)
}
