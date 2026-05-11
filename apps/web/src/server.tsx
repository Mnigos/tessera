import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { Register } from '@tanstack/react-router'
import {
	defineHandlerCallback,
	transformReadableStreamWithRouter,
} from '@tanstack/react-router/ssr/server'
import {
	createStartHandler,
	type RequestHandler,
	StartServer,
} from '@tanstack/react-start/server'
import ReactDOMServer from 'react-dom/server'

function isAbortError(error: unknown) {
	if (!(error instanceof Error)) return false

	return (
		error.name === 'AbortError' ||
		error.message === 'The connection was closed.' ||
		('code' in error && error.code === 20)
	)
}

const streamHandler = defineHandlerCallback(
	async ({ router, responseHeaders }) => {
		const stream = (await ReactDOMServer.renderToReadableStream(
			<StartServer router={router} />,
			{
				nonce: router.options.ssr?.nonce,
				progressiveChunkSize: Number.POSITIVE_INFINITY,
			}
		)) as unknown as NodeReadableStream

		const responseStream = transformReadableStreamWithRouter(router, stream)

		return new Response(responseStream as unknown as BodyInit, {
			status: router.stores.statusCode.get(),
			headers: responseHeaders,
		})
	}
)

const startHandler = createStartHandler(streamHandler)

interface ServerEntry {
	fetch: RequestHandler<Register>
}

function createServerEntry(entry: ServerEntry): ServerEntry {
	return {
		async fetch(request, ...args) {
			try {
				return await entry.fetch(request, ...args)
			} catch (error) {
				if (request.signal.aborted || isAbortError(error))
					return new Response(null, { status: 204 })

				throw error
			}
		},
	}
}

export default createServerEntry({ fetch: startHandler })
