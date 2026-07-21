import { APIError } from 'better-auth/api'
import { assertOrganizationSlugNotUserHandle } from './handle-shadowing'

describe(assertOrganizationSlugNotUserHandle.name, () => {
	test('allows slugs that do not match a user handle', async () => {
		expect(
			await assertOrganizationSlugNotUserHandle('acme', async () => false)
		).toBeUndefined()
	})

	test('rejects slugs that match an existing user handle', async () => {
		const promise = assertOrganizationSlugNotUserHandle(
			'marta',
			async () => true
		)

		await expect(promise).rejects.toBeInstanceOf(APIError)
		await expect(promise).rejects.toMatchObject({
			body: {
				message: 'This organization slug is already taken by a user.',
			},
		})
	})

	test('compares slugs against handles case-insensitively', async () => {
		const checkedHandles: string[] = []

		await expect(
			assertOrganizationSlugNotUserHandle('Marta', handle => {
				checkedHandles.push(handle)
				return Promise.resolve(true)
			})
		).rejects.toBeInstanceOf(APIError)
		expect(checkedHandles).toEqual(['marta'])
	})

	test('skips missing slugs', async () => {
		const isUserHandleTaken = vi.fn()

		await assertOrganizationSlugNotUserHandle(undefined, isUserHandleTaken)

		expect(isUserHandleTaken).not.toHaveBeenCalled()
	})
})
