import type { AppRequest } from '~/shared/types/app-request'
import { toForwardedAuthHeaders } from './forwarded-auth-headers'

describe(toForwardedAuthHeaders.name, () => {
	test('forwards session headers without body metadata', () => {
		expect(
			toForwardedAuthHeaders({
				headers: {
					cookie: 'better-auth.session_token=signed',
					'user-agent': 'vitest',
					'content-type': 'application/json',
					'content-length': '42',
				},
			} as unknown as AppRequest)
		).toEqual({
			cookie: 'better-auth.session_token=signed',
			'user-agent': 'vitest',
		})
	})

	test('returns no headers when the adapter supplied none', () => {
		expect(toForwardedAuthHeaders({} as AppRequest)).toEqual({})
	})
})
