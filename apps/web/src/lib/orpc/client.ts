import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import { ResponseValidationPlugin } from '@orpc/contract/plugins'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { type Contract, contract } from '@repo/contracts'
import { getGlobalStartContext } from '@tanstack/react-start'
import { getHeaders } from '@/server/helpers'
import { getApiUrl } from '@/utils/get-api-url'

interface RequestSignalContext {
	requestSignal?: AbortSignal
}

function resolveHeaders() {
	if (typeof window !== 'undefined') return {}

	return getHeaders()
}

function resolveRequestSignal() {
	const startContext = getGlobalStartContext() as
		| RequestSignalContext
		| undefined

	return startContext?.requestSignal
}

function mergeRequestSignals(signals: Array<AbortSignal | undefined>) {
	const activeSignals = signals.filter(signal => signal !== undefined)

	if (activeSignals.length <= 1) return activeSignals[0]

	if (typeof AbortSignal.any === 'function')
		return AbortSignal.any(activeSignals)

	const abortController = new AbortController()
	const abortedSignal = activeSignals.find(signal => signal.aborted)

	if (abortedSignal) {
		abortController.abort(abortedSignal.reason)
		return abortController.signal
	}

	function abort() {
		for (const signal of activeSignals)
			signal.removeEventListener('abort', abort)

		const latestAbortedSignal = activeSignals.find(signal => signal.aborted)

		abortController.abort(latestAbortedSignal?.reason)
	}

	for (const signal of activeSignals)
		signal.addEventListener('abort', abort, { once: true })

	return abortController.signal
}

const link = new OpenAPILink(contract, {
	url: getApiUrl(),
	fetch: (request, init) =>
		fetch(request, {
			...init,
			credentials: 'include',
			signal: mergeRequestSignals([request.signal, resolveRequestSignal()]),
		}),
	headers: resolveHeaders,
	plugins: [new ResponseValidationPlugin(contract)],
})

export const orpc: ContractRouterClient<Contract> = createORPCClient(link)
