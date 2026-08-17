import { buildInvitationUrl } from './build-invitation-url'

describe(buildInvitationUrl.name, () => {
	test('builds an absolute invitation URL from the site origin', () => {
		expect(
			buildInvitationUrl(
				'https://tessera.example/settings',
				'00000000-0000-4000-8000-000000000030'
			)
		).toBe(
			'https://tessera.example/invitations/00000000-0000-4000-8000-000000000030'
		)
	})
})
