import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { account, and, desc, eq, ne, organization, sql, user } from '@repo/db'
import type { OrganizationId, UserId } from '@repo/domain'

interface IsHandleTakenParams {
	handle: string
	ignoreOrganizationId?: OrganizationId
}

interface FindGitHubAccountParams {
	userId: UserId
}

/**
 * The actor's linked GitHub identity as Tessera stores it: a durable numeric
 * account id and, when the OAuth flow left one, a token to ask GitHub with.
 */
export interface GitHubAccountIdentity {
	accountId: string
	accessToken: string | null
	accessTokenExpiresAt: Date | null
}

@Injectable()
export class OrganizationHandlePolicyRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Whether a Tessera user or organization already answers to a handle.
	 *
	 * Both namespaces are checked because they are served from the same
	 * `/{handle}` space, and both sides of each comparison are lowercased here so
	 * the answer never depends on how a caller happened to normalize.
	 * `ignoreOrganizationId` lets a rename tolerate the organization's own
	 * current handle.
	 *
	 * Lowercasing forgoes the unique btree on `user.username` and
	 * `organization.slug`, which is affordable because this runs once per
	 * organization create or rename. It is also a read, so it cannot close the
	 * race with the insert that follows: the underlying unique indexes are still
	 * case-sensitive, so two concurrent creates of `Foo` and `foo` both survive
	 * until TES-61 replaces this with a database-level shared namespace.
	 */
	async isHandleTaken({
		handle,
		ignoreOrganizationId,
	}: IsHandleTakenParams): Promise<boolean> {
		const organizationHandleTaken = sql`lower(${organization.slug}) = lower(${handle})`

		const [takenUsernames, takenSlugs] = await Promise.all([
			this.db
				.select({ id: user.id })
				.from(user)
				.where(sql`lower(${user.username}) = lower(${handle})`)
				.limit(1),
			this.db
				.select({ id: organization.id })
				.from(organization)
				.where(
					ignoreOrganizationId
						? and(
								organizationHandleTaken,
								ne(organization.id, ignoreOrganizationId)
							)
						: organizationHandleTaken
				)
				.limit(1),
		])

		return takenUsernames.length > 0 || takenSlugs.length > 0
	}

	/**
	 * The actor's GitHub account row, which is the only durable proof Tessera
	 * holds that a user controls a GitHub identity.
	 *
	 * Nothing stops a user having more than one GitHub account row — re-linking
	 * writes another — and neither the schema nor Better Auth makes
	 * `(userId, providerId)` unique, so the most recently updated one wins. An
	 * arbitrary row would otherwise hand back a dead token or a stale account id
	 * and turn a valid claim into a conflict.
	 */
	async findGitHubAccount({
		userId,
	}: FindGitHubAccountParams): Promise<GitHubAccountIdentity | undefined> {
		return await this.db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
			orderBy: [desc(account.updatedAt)],
			columns: {
				accountId: true,
				accessToken: true,
				accessTokenExpiresAt: true,
			},
		})
	}
}
