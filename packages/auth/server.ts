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
import { apiKeyEndpointLockdown } from './src/api-key-endpoint-lockdown'
import {
	CHECK_STATUS_CREDENTIAL_CONFIG_ID,
	CHECK_STATUS_CREDENTIAL_DEFAULT_PERMISSION,
	CHECK_STATUS_CREDENTIAL_PERMISSIONS,
	CHECK_STATUS_CREDENTIAL_PREFIX,
} from './src/check-status-credentials'
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
import { organizationEndpointLockdown } from './src/organization-endpoint-lockdown'

async function isUserHandleTaken(slug: string) {
	const foundUser = await db.query.user.findFirst({
		where: eq(user.username, slug),
		columns: {
			id: true,
		},
	})

	return foundUser !== undefined
}

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
							isUserHandleTaken
						),
					// Better Auth passes only the fields being changed, so an update
					// that leaves the slug alone arrives without one.
					beforeUpdateOrganization: async ({
						organization: organizationUpdate,
					}) =>
						await assertOrganizationSlugNotUserHandle(
							organizationUpdate.slug,
							isUserHandleTaken
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
				// A Git token inherits every repository its user can write, which is
				// the opposite of a credential confined to one repository, so status
				// publishers get a configuration — and a prefix — of their own.
				{
					configId: CHECK_STATUS_CREDENTIAL_CONFIG_ID,
					defaultPrefix: CHECK_STATUS_CREDENTIAL_PREFIX,
					maximumNameLength: 64,
					references: 'user',
					permissions: {
						defaultPermissions:
							CHECK_STATUS_CREDENTIAL_PERMISSIONS[
								CHECK_STATUS_CREDENTIAL_DEFAULT_PERMISSION
							],
					},
					// CI reports a status per job transition: a busier caller than a
					// person pushing over HTTPS.
					rateLimit: {
						enabled: true,
						timeWindow: 1000 * 60,
						maxRequests: 600,
					},
				},
			]),
			apiKeyEndpointLockdown(),
			organizationEndpointLockdown(),
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
