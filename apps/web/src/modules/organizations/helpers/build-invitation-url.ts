export function buildInvitationUrl(origin: string, invitationId: string) {
	return new URL(`/invitations/${invitationId}`, origin).toString()
}
