import { createFileRoute } from '@tanstack/react-router'
import { env } from '@/env'

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
])

interface CookieReadableHeaders {
	getSetCookie?: () => string[]
}

export const Route = createFileRoute('/api/auth/$')({
	server: {
		handlers: {
			DELETE: ({ request }) => proxyAuthRequest(request),
			GET: ({ request }) => proxyAuthRequest(request),
			OPTIONS: ({ request }) => proxyAuthRequest(request),
			PATCH: ({ request }) => proxyAuthRequest(request),
			POST: ({ request }) => proxyAuthRequest(request),
			PUT: ({ request }) => proxyAuthRequest(request),
		},
	},
})

async function proxyAuthRequest(request: Request) {
	const upstreamUrl = getUpstreamUrl(request.url)
	const response = await fetch(upstreamUrl, {
		body: getRequestBody(request),
		headers: getForwardedHeaders(request.headers),
		method: request.method,
		redirect: 'manual',
	})

	const headers = getResponseHeaders(response.headers)

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	})
}

function getUpstreamUrl(requestUrl: string) {
	const url = new URL(requestUrl)
	const upstreamUrl = new URL(url.pathname + url.search, env.API_URL)

	return upstreamUrl.toString()
}

function getRequestBody(request: Request) {
	if (request.method === 'GET' || request.method === 'HEAD') return undefined

	return request.body
}

function getForwardedHeaders(headers: Headers) {
	const forwardedHeaders = new Headers()

	for (const [name, value] of headers)
		if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name !== 'host')
			forwardedHeaders.set(name, value)

	return forwardedHeaders
}

function getResponseHeaders(headers: Headers) {
	const responseHeaders = new Headers()
	const readableHeaders = headers as Headers & CookieReadableHeaders

	for (const [name, value] of headers)
		if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name !== 'set-cookie')
			responseHeaders.set(name, value)

	for (const cookie of readableHeaders.getSetCookie?.() ?? [])
		responseHeaders.append('set-cookie', cookie)

	return responseHeaders
}
