import { createMiddleware, createStart } from '@tanstack/react-start'

const requestSignalMiddleware = createMiddleware().server(({ next, request }) =>
	next({
		context: {
			requestSignal: request.signal,
		},
	})
)

export const startInstance = createStart(() => ({
	requestMiddleware: [requestSignalMiddleware],
}))
