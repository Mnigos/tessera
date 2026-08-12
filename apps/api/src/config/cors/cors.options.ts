import type { HonoAdapter } from '@mnigos/platform-hono'

type CorsOptions = NonNullable<Parameters<HonoAdapter['enableCors']>[0]>

/**
 * Explicit non-empty allow-list of request headers accepted on cross-origin
 * API calls.
 *
 * Kept explicit so Hono's CORS middleware does not fall back to echoing the
 * attacker-controlled `Access-Control-Request-Headers` request header (the
 * ReDoS vector tracked as GHSA-8j4g-w8fx-2239). The set matches what the web
 * client actually sends: JSON requests via the oRPC `OpenAPILink`
 * (`Content-Type`, `Accept`) plus the standard `Authorization` header. Session
 * cookies travel via `credentials: true` and are not part of this list.
 */
export const CORS_ALLOW_HEADERS = ['Accept', 'Authorization', 'Content-Type']

/**
 * Builds the CORS options passed to the Hono adapter's `enableCors`.
 *
 * The return type is Hono's own CORS options shape, so using the wrong option
 * key (for example Nest's `allowedHeaders` instead of Hono's `allowHeaders`)
 * fails to type-check rather than being silently ignored at runtime.
 */
export function createCorsOptions(origin: string): CorsOptions {
	return {
		origin,
		credentials: true,
		allowHeaders: CORS_ALLOW_HEADERS,
	}
}
