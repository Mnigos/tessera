import { toHandle } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { parseOrganizationForm } from '../helpers/parse-organization-form'
import { useCreateOrganizationMutation } from '../hooks/use-create-organization.mutation'
import { OrganizationHandleField } from './organization-handle-field'

const CREATE_ORGANIZATION_ERROR_ID = 'create-organization-error'
const NAME_INPUT_CLASSNAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

export function CreateOrganizationForm() {
	const navigate = useNavigate()
	const [name, setName] = useState('')
	const [slug, setSlug] = useState('')
	// Until the handle is typed into directly it follows the name, which is what
	// people expect; after that it stops moving under them.
	const [isSlugEdited, setIsSlugEdited] = useState(false)
	const [validationMessage, setValidationMessage] = useState<string>()
	const createOrganization = useCreateOrganizationMutation()
	const errorMessage =
		validationMessage ??
		(createOrganization.isError
			? getOrganizationErrorMessage(
					createOrganization.error,
					'Organization could not be created.'
				)
			: undefined)

	function handleNameChange(value: string) {
		setName(value)

		if (!isSlugEdited) setSlug(toHandle(value))
	}

	function handleSlugChange(value: string) {
		setIsSlugEdited(true)
		setSlug(value)
	}

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const parsed = parseOrganizationForm({ name, slug })

		if (!parsed.success) {
			setValidationMessage(parsed.message)
			return
		}

		setValidationMessage(undefined)
		createOrganization.mutate(parsed.data, {
			onSuccess: ({ organization }) =>
				navigate({
					to: '/organizations/$slug/settings',
					params: { slug: organization.slug },
				}),
		})
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-2xl tracking-normal">
					New organization
				</h1>
				<p className="text-muted-foreground text-sm">
					Organizations own repositories together. You will be its owner.
				</p>
			</div>
			<form
				aria-describedby={
					errorMessage ? CREATE_ORGANIZATION_ERROR_ID : undefined
				}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor="organization-name">Name</Label>
					<input
						autoComplete="off"
						className={NAME_INPUT_CLASSNAME}
						id="organization-name"
						name="name"
						onChange={event => handleNameChange(event.target.value)}
						required
						value={name}
					/>
				</div>
				<OrganizationHandleField
					description="It has to be free here and unclaimed on GitHub."
					id="organization-slug"
					onValueChange={handleSlugChange}
					value={slug}
				/>
				{errorMessage && (
					<p
						className="text-destructive text-sm"
						id={CREATE_ORGANIZATION_ERROR_ID}
						role="alert"
					>
						{errorMessage}
					</p>
				)}
				<Button
					className="self-start"
					disabled={createOrganization.isPending}
					type="submit"
				>
					<Plus className="size-4" />
					{createOrganization.isPending ? 'Creating' : 'Create organization'}
				</Button>
			</form>
		</Card>
	)
}
