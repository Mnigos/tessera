import { myOrganizationInvitationInputSchema } from '@repo/contracts'

export function parseInvitationId(invitationId: string): string | undefined {
	const parsed = myOrganizationInvitationInputSchema.safeParse({ invitationId })

	return parsed.success ? parsed.data.invitationId : undefined
}
