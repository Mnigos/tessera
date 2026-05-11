import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

export const getHeaders = createIsomorphicFn()
	.client(() => ({}))
	.server(() =>
		Object.fromEntries(
			Array.from(getRequestHeaders().entries()).filter(
				([headerName]) => headerName.toLowerCase() !== 'host'
			)
		)
	)
