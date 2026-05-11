import { db } from '@repo/db/client'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0'])
const LEADING_SUBDOMAIN_REGEX = /^(www|app)\./
const RAILWAY_PUBLIC_HOST_SUFFIX = '.up.railway.app'

function getCookieDomain(origin: string) {
	try {
		const hostname = new URL(origin).hostname.toLowerCase()
		if (
			LOCAL_HOSTNAMES.has(hostname) ||
			hostname.endsWith(RAILWAY_PUBLIC_HOST_SUFFIX) ||
			hostname.endsWith('.localhost') ||
			hostname.endsWith('.local')
		)
			return

		const domain = hostname.replace(LEADING_SUBDOMAIN_REGEX, '')
		if (!domain.includes('.')) return

		return `.${domain}`
	} catch {
		return
	}
}

export interface AuthConfigOptions {
	apiUrl: string
	secret: string | undefined
	githubClientId?: string
	githubClientSecret?: string
	trustedOrigins: string[]
	advanced?: BetterAuthOptions['advanced']
}

export function initAuth({
	apiUrl,
	secret,
	githubClientId,
	githubClientSecret,
	trustedOrigins,
	advanced,
}: AuthConfigOptions) {
	const cookieDomain = getCookieDomain(trustedOrigins[0] ?? apiUrl)
	const isSecure = apiUrl.startsWith('https://')
	const authAdvanced: BetterAuthOptions['advanced'] = {
		database: {
			generateId: 'uuid',
		},
		defaultCookieAttributes: {
			sameSite: 'lax',
			secure: isSecure,
		},
		...(cookieDomain
			? {
					crossSubDomainCookies: {
						enabled: true,
						domain: cookieDomain,
					},
				}
			: {}),
		...advanced,
	}

	return betterAuth({
		secret,
		baseURL: apiUrl,
		basePath: '/api/auth',
		database: drizzleAdapter(db, {
			provider: 'pg',
		}),
		socialProviders: {
			github: {
				clientId: githubClientId ?? '',
				clientSecret: githubClientSecret ?? '',
			},
		},
		plugins: [organization()],
		trustedOrigins,
		advanced: authAdvanced,
	})
}

export type Auth = ReturnType<typeof initAuth>
