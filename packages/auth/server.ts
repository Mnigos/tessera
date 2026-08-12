import { apiKey } from '@better-auth/api-key'
import {
	account,
	and,
	eq,
	organization as organizationTable,
	user,
} from '@repo/db'
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
import { assertOrganizationSlugNotUserHandle } from './src/handle-shadowing'

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
	/**
	 * HS256 signing secret. Must be a strong, non-public value: better-auth
	 * registers GET /api/auth/verify-email unconditionally and its
	 * `change-email-verification` branch creates a real DB-backed session +
	 * updates the user email for ANY token validly signed with this secret,
	 * without gating on `user.changeEmail.enabled` (verified in better-auth
	 * 1.6.27, dist/api/routes/email-verification.mjs). There is no supported
	 * option to disable or unmount that route in this version, so the strong
	 * secret is the effective control — see the required-in-production guard in
	 * apps/api/src/config/env/env.schema.ts. Follow-up: track the better-auth
	 * upgrade (TSR-07) and optionally block /api/auth/verify-email at the
	 * Nest/proxy layer as an extra defense-in-depth layer (out of scope here).
	 */
	secret: string
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
				scope: ['repo'],
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
						// Usernames matching an organization slug are treated as taken so
						// a new user cannot shadow an organization page. Application-level
						// check only; the DB-level guarantee is tracked by TES-61.
						username: await resolveGitHubUsername(profile, async username => {
							const [foundUser, foundOrganization] = await Promise.all([
								db.query.user.findFirst({
									where: eq(user.username, username),
									columns: {
										id: true,
									},
								}),
								db.query.organization.findFirst({
									where: eq(organizationTable.slug, username),
									columns: {
										id: true,
									},
								}),
							])

							return foundUser !== undefined || foundOrganization !== undefined
						}),
					}
				},
			},
		},
		plugins: [
			organization({
				organizationHooks: {
					beforeCreateOrganization: async ({ organization: newOrganization }) =>
						await assertOrganizationSlugNotUserHandle(
							newOrganization.slug,
							async slug => {
								const foundUser = await db.query.user.findFirst({
									where: eq(user.username, slug),
									columns: {
										id: true,
									},
								})

								return foundUser !== undefined
							}
						),
				},
			}),
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
					rateLimit: {
						enabled: true,
						timeWindow: 1000 * 60,
						maxRequests: 120,
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
export { assertOrganizationSlugNotUserHandle } from './src/handle-shadowing'
