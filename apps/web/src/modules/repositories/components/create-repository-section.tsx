import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Plus } from 'lucide-react'
import type { ComponentProps } from 'react'
import { getCreateRepositoryInput } from '../helpers/create-repository-input'
import { useCreateRepositoryMutation } from '../hooks/use-create-repository.mutation'

interface CreateRepositorySectionProps {
	username: string
}

export function CreateRepositorySection({
	username,
}: Readonly<CreateRepositorySectionProps>) {
	const createRepository = useCreateRepositoryMutation(username)

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		createRepository.mutate(
			getCreateRepositoryInput(new FormData(event.currentTarget))
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Create repository
				</h2>
				<p className="text-muted-foreground text-sm">
					Start a repository under @{username}.
				</p>
			</div>
			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="repository-name">Name</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="repository-name"
						name="name"
						required
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="repository-slug">Slug</Label>
					<input
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="repository-slug"
						name="slug"
						placeholder="optional"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="repository-description">Description</Label>
					<textarea
						className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id="repository-description"
						name="description"
						placeholder="optional"
					/>
				</div>
				<fieldset className="flex flex-col gap-2">
					<legend className="font-medium text-sm">Visibility</legend>
					<div className="grid grid-cols-2 gap-2">
						<label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
							<input
								className="accent-primary"
								name="visibility"
								type="radio"
								value="public"
							/>
							Public
						</label>
						<label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
							<input
								className="accent-primary"
								defaultChecked
								name="visibility"
								type="radio"
								value="private"
							/>
							Private
						</label>
					</div>
				</fieldset>
				{createRepository.isError && (
					<p className="text-destructive text-sm">
						Repository could not be created.
					</p>
				)}
				<Button
					className="w-full"
					disabled={createRepository.isPending}
					type="submit"
				>
					<Plus className="size-4" />
					{createRepository.isPending ? 'Creating' : 'Create repository'}
				</Button>
			</form>
		</Card>
	)
}
