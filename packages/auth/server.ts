import { apiKey } from '@better-auth/api-key'
import { account, and, eq, user } from '@repo/db'
import { db } from '@repo/db/client'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import {
	GIT_ACCESS_TOKEN_CONFIG_ID,
	GIT_ACCESS_TOKEN_DEFAULT_PERMISSION,
	GIT_ACCESS_TOKEN_PERMISSIONS,
	GIT_ACCESS_TOKEN_PREFIX,
} from './src/git-access-tokens'
import {
	preserveExistingUsernameOnUpdate,
	resolveGitHubUsername,
} from './src/github-username'

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
		user: {
			additionalFields: {
				username: {
					type: 'string',
					required: false,
					input: false,
				},
			},
		},
		socialProviders: {
			github: {
				clientId: githubClientId ?? '',
				clientSecret: githubClientSecret ?? '',
				mapProfileToUser: async profile => {
					const existingAccount = await db.query.account.findFirst({
						where: and(
							eq(account.providerId, 'github'),
							eq(account.accountId, String(profile.id))
						),
						columns: {
							id: true,
						},
					})

					if (existingAccount) return {}

					return {
						username: await resolveGitHubUsername(profile, async username => {
							const foundUser = await db.query.user.findFirst({
								where: eq(user.username, username),
								columns: {
									id: true,
								},
							})

							return foundUser !== undefined
						}),
					}
				},
			},
		},
		plugins: [
			organization(),
			apiKey([
				{
					configId: GIT_ACCESS_TOKEN_CONFIG_ID,
					defaultPrefix: GIT_ACCESS_TOKEN_PREFIX,
					maximumNameLength: 64,
					references: 'user',
					permissions: {
						defaultPermissions:
							GIT_ACCESS_TOKEN_PERMISSIONS[GIT_ACCESS_TOKEN_DEFAULT_PERMISSION],
					},
				},
			]),
		],
		trustedOrigins,
		advanced: authAdvanced,
		databaseHooks: {
			user: {
				update: {
					before: async userUpdateData => {
						const nextUserData = await preserveExistingUsernameOnUpdate(
							userUpdateData,
							async email => {
								const foundUser = await db.query.user.findFirst({
									where: eq(user.email, email.toLowerCase()),
									columns: {
										username: true,
									},
								})

								return !!foundUser?.username
							}
						)
						if (nextUserData === userUpdateData) return

						return { data: nextUserData }
					},
				},
			},
		},
	})
}

export type Auth = ReturnType<typeof initAuth>
export {
	createSuffixedUsername,
	createUsernameSuffix,
	normalizeUsername,
	preserveExistingUsernameOnUpdate,
	resolveGitHubUsername,
} from './src/github-username'
