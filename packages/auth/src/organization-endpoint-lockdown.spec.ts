import { organizationEndpointLockdown } from './organization-endpoint-lockdown'

const plugin = organizationEndpointLockdown()

async function requestPath(pathname: string) {
	const result = await plugin.onRequest?.(
		new Request(`https://tessera.test${pathname}`),
		{} as never
	)

	return result && 'response' in result ? result.response : undefined
}

describe('organization endpoint lockdown', () => {
	test('refuses every organization mutation route', async () => {
		const blocked = [
			'/api/auth/organization/create',
			'/api/auth/organization/update',
			'/api/auth/organization/delete',
			'/api/auth/organization/set-active',
			'/api/auth/organization/invite-member',
			'/api/auth/organization/accept-invitation',
			'/api/auth/organization/reject-invitation',
			'/api/auth/organization/cancel-invitation',
			'/api/auth/organization/remove-member',
			'/api/auth/organization/update-member-role',
			'/api/auth/organization/leave',
		]

		for (const pathname of blocked)
			expect((await requestPath(pathname))?.status).toBe(404)
	})

	test('refuses mutations under another base path and with trailing slashes', async () => {
		expect((await requestPath('/auth/organization/create'))?.status).toBe(404)
		expect((await requestPath('/api/auth/organization/delete/'))?.status).toBe(
			404
		)
		expect((await requestPath('/api/auth/organization/leave///'))?.status).toBe(
			404
		)
	})

	test('leaves organization read routes open', async () => {
		const allowed = [
			'/api/auth/organization/list',
			'/api/auth/organization/get-full-organization',
			'/api/auth/organization/list-members',
			'/api/auth/organization/list-invitations',
			'/api/auth/organization/list-user-invitations',
			'/api/auth/organization/get-invitation',
			'/api/auth/organization/check-slug',
			'/api/auth/organization/get-active-member',
			'/api/auth/organization/get-active-member-role',
		]

		for (const pathname of allowed)
			expect(await requestPath(pathname)).toBeUndefined()
	})

	test('does not block paths that merely extend a mutation suffix', async () => {
		expect(
			await requestPath('/api/auth/organization/create/preview')
		).toBeUndefined()
		expect(await requestPath('/api/auth/organizations/create')).toBeUndefined()
	})
})
