import { parseInvitationId } from './parse-invitation-id'

describe(parseInvitationId.name, () => {
	test('returns a valid invitation id', () => {
		expect(parseInvitationId('00000000-0000-4000-8000-000000000030')).toBe(
			'00000000-0000-4000-8000-000000000030'
		)
	})

	test.each([
		'',
		'not-a-uuid',
		'00000000-0000-4000-8000-00000000000',
	])('rejects invalid id %j', invitationId => {
		expect(parseInvitationId(invitationId)).toBeUndefined()
	})
})
