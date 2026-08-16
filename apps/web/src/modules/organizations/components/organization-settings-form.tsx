import type { Organization } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { useNavigate } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { parseOrganizationForm } from '../helpers/parse-organization-form'
import { useUpdateOrganizationMutation } from '../hooks/use-update-organization.mutation'
import { OrganizationHandleField } from './organization-handle-field'

const UPDATE_ORGANIZATION_ERROR_ID = 'update-organization-error'
const NAME_INPUT_CLASSNAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

interface OrganizationSettingsFormProps {
	organization: Organization
	canRename: boolean
}

export function OrganizationSettingsForm({
	organization,
	canRename,
}: Readonly<OrganizationSettingsFormProps>) {
	const navigate = useNavigate()
	const [name, setName] = useState(organization.name)
	const [slug, setSlug] = useState(organization.slug)
	const [validationMessage, setValidationMessage] = useState<string>()
	const updateOrganization = useUpdateOrganizationMutation()
	const isHandleChanged = slug !== organization.slug
	const isUnchanged = name === organization.name && !isHandleChanged
	const errorMessage =
		validationMessage ??
		(updateOrganization.isError
			? getOrganizationErrorMessage(
					updateOrganization.error,
					'Changes could not be saved.'
				)
			: undefined)

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const parsed = parseOrganizationForm({ name, slug })

		if (!parsed.success) {
			setValidationMessage(parsed.message)
			return
		}

		setValidationMessage(undefined)
		updateOrganization.mutate(
			{ organizationId: organization.id, ...parsed.data },
			{
				onSuccess: ({ organization: updated }) =>
					navigate({
						to: '/organizations/$slug/settings',
						params: { slug: updated.slug },
						replace: true,
					}),
			}
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">General</h2>
				<p className="text-muted-foreground text-sm">
					{canRename
						? 'Change how this organization is named and addressed.'
						: 'Only owners and admins can change these.'}
				</p>
			</div>
			<form
				aria-describedby={
					errorMessage ? UPDATE_ORGANIZATION_ERROR_ID : undefined
				}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<fieldset className="flex flex-col gap-4" disabled={!canRename}>
					<div className="flex flex-col gap-2">
						<Label htmlFor="organization-settings-name">Name</Label>
						<input
							autoComplete="off"
							className={NAME_INPUT_CLASSNAME}
							id="organization-settings-name"
							name="name"
							onChange={event => setName(event.target.value)}
							required
							value={name}
						/>
					</div>
					<OrganizationHandleField
						id="organization-settings-slug"
						onValueChange={setSlug}
						value={slug}
					/>
				</fieldset>
				{isHandleChanged && (
					<output className="flex items-start gap-2 rounded-md border border-border border-dashed p-3 text-muted-foreground text-sm">
						<TriangleAlert className="mt-0.5 size-4 shrink-0" />
						Renaming changes clone URLs for all repositories. Existing remotes
						stop working until they are updated.
					</output>
				)}
				{errorMessage && (
					<p
						className="text-destructive text-sm"
						id={UPDATE_ORGANIZATION_ERROR_ID}
						role="alert"
					>
						{errorMessage}
					</p>
				)}
				<Button
					className="self-start"
					disabled={!canRename || isUnchanged || updateOrganization.isPending}
					type="submit"
				>
					{updateOrganization.isPending ? 'Saving' : 'Save changes'}
				</Button>
			</form>
		</Card>
	)
}
