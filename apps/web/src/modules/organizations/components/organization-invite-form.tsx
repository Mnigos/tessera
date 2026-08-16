import type { Organization } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { UserPlus } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { useInviteOrganizationMemberMutation } from '../hooks/use-invite-organization-member.mutation'
import { OrganizationRoleSelect } from './organization-role-select'

const INVITE_ERROR_ID = 'organization-invite-error'
const DEFAULT_INVITE_ROLE: OrganizationRole = 'member'

interface OrganizationInviteFormProps {
	organizationId: Organization['id']
	viewerRole: OrganizationRole
}

export function OrganizationInviteForm({
	organizationId,
	viewerRole,
}: Readonly<OrganizationInviteFormProps>) {
	const [role, setRole] = useState<OrganizationRole>(DEFAULT_INVITE_ROLE)
	const inviteMember = useInviteOrganizationMemberMutation()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const form = event.currentTarget
		const email = String(new FormData(form).get('email') ?? '').trim()

		if (!email) return

		inviteMember.mutate(
			{ organizationId, email, role },
			{
				onSuccess: () => {
					form.reset()
					setRole(DEFAULT_INVITE_ROLE)
				},
			}
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Invite a member
				</h2>
				<p className="text-muted-foreground text-sm">
					They accept with a Tessera account using this address. Copy the link
					from the list below and send it to them yourself.
				</p>
			</div>
			<form
				aria-describedby={inviteMember.isError ? INVITE_ERROR_ID : undefined}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<div className="flex flex-1 flex-col gap-2">
						<Label htmlFor="organization-invite-email">Email</Label>
						<Input
							autoCapitalize="none"
							autoComplete="off"
							id="organization-invite-email"
							name="email"
							required
							spellCheck={false}
							type="email"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="organization-invite-role">Role</Label>
						<OrganizationRoleSelect
							canAssignOwner={viewerRole === 'owner'}
							id="organization-invite-role"
							onRoleChange={setRole}
							role={role}
						/>
					</div>
					<Button
						className="w-full sm:w-auto"
						disabled={inviteMember.isPending}
						type="submit"
					>
						<UserPlus className="size-4" />
						{inviteMember.isPending ? 'Inviting' : 'Send invitation'}
					</Button>
				</div>
				{inviteMember.isError && (
					<p
						className="text-destructive text-sm"
						id={INVITE_ERROR_ID}
						role="alert"
					>
						{getOrganizationErrorMessage(
							inviteMember.error,
							'Invitation could not be created.'
						)}
					</p>
				)}
			</form>
		</Card>
	)
}
