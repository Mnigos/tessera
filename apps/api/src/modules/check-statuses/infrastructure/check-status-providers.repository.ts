import { Database } from '@config/database'
import type { CheckStatusCredentialAuthorization } from '@modules/checks'
import { Injectable } from '@nestjs/common'
import {
	and,
	apikey,
	asc,
	checkStatusCredentials,
	checkStatusProviders,
	type DrizzleTransaction,
	eq,
	isNull,
	type RepositoryEvent,
	type RepositoryEventPayload,
	repositoryEvents,
} from '@repo/db'
import type {
	ApiKeyId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
	UserId,
} from '@repo/domain'

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface FindProviderParams extends RepositoryParams {
	providerId: CheckStatusProviderId
}

interface CreateProviderParams extends RepositoryParams {
	actorUserId: UserId
	providerKey: string
	displayName: string
}

interface CreateCredentialParams extends RepositoryParams {
	actorUserId: UserId
	provider: CheckStatusProviderView
	/** The key that was just minted, which is the only thing that knows it. */
	key: MintedApiKey
}

/**
 * What Better Auth returned for a key it has just issued. The credential row
 * records the reference; these are the parts of the secret's own record that a
 * reader is allowed to see, and they come from the mint rather than from a
 * default this table would otherwise have to invent.
 */
export interface MintedApiKey {
	id: ApiKeyId
	start: string | null
	expiresAt: Date | null
}

interface CreateProviderWithCredentialParams extends CreateProviderParams {
	key: MintedApiKey
}

export interface CreatedCheckStatusProvider {
	provider: CheckStatusProviderView
	credential: CheckStatusCredentialView
}

interface RevokeCredentialParams extends RepositoryParams {
	actorUserId: UserId
	credentialId: CheckStatusCredentialId
}

export interface CheckStatusProviderView {
	id: CheckStatusProviderId
	key: string
	displayName: string
	createdAt: Date
	updatedAt: Date
}

/**
 * A credential as its repository sees it: the row's own identity plus the parts
 * of the underlying key that are safe to look at. The secret is not among them.
 */
export interface CheckStatusCredentialView {
	id: CheckStatusCredentialId
	providerId: CheckStatusProviderId
	/** Absent once the key itself is gone, which outlives nothing but the row. */
	apiKeyId: ApiKeyId | null
	start: string | null
	/** Better Auth defaults it, so absent reads as a key nothing has disabled. */
	enabled: boolean | null
	revokedAt: Date | null
	expiresAt: Date | null
	lastUsedAt: Date | null
	createdAt: Date
}

/**
 * Both outcomes carry the key so retiring the secret can be retried. Disabling
 * it happens after the row is committed, so a revocation that already went
 * through must still hand back what a repeat attempt needs to finish the job.
 */
interface RevokedCheckStatusCredential {
	apiKeyId: ApiKeyId | null
	createdByUserId: UserId
}

export type RevokeCheckStatusCredentialResult =
	| ({ status: 'revoked' | 'already_revoked' } & RevokedCheckStatusCredential)
	| { status: 'not_found' }

const PROVIDER_COLUMNS = {
	id: checkStatusProviders.id,
	key: checkStatusProviders.key,
	displayName: checkStatusProviders.displayName,
	createdAt: checkStatusProviders.createdAt,
	updatedAt: checkStatusProviders.updatedAt,
}

const CREDENTIAL_COLUMNS = {
	id: checkStatusCredentials.id,
	providerId: checkStatusCredentials.providerId,
	apiKeyId: checkStatusCredentials.apiKeyId,
	start: apikey.start,
	enabled: apikey.enabled,
	revokedAt: checkStatusCredentials.revokedAt,
	expiresAt: apikey.expiresAt,
	lastUsedAt: apikey.lastRequest,
	createdAt: checkStatusCredentials.createdAt,
}

@Injectable()
export class CheckStatusProvidersRepository {
	constructor(private readonly db: Database) {}

	async listProviders({
		repositoryId,
	}: RepositoryParams): Promise<CheckStatusProviderView[]> {
		return await this.db
			.select(PROVIDER_COLUMNS)
			.from(checkStatusProviders)
			.where(eq(checkStatusProviders.repositoryId, repositoryId))
			.orderBy(asc(checkStatusProviders.key))
	}

	async listCredentials({
		repositoryId,
	}: RepositoryParams): Promise<CheckStatusCredentialView[]> {
		return await this.db
			.select(CREDENTIAL_COLUMNS)
			.from(checkStatusCredentials)
			.innerJoin(
				checkStatusProviders,
				eq(checkStatusProviders.id, checkStatusCredentials.providerId)
			)
			.leftJoin(apikey, eq(apikey.id, checkStatusCredentials.apiKeyId))
			.where(eq(checkStatusProviders.repositoryId, repositoryId))
			.orderBy(asc(checkStatusCredentials.createdAt))
	}

	async findProvider({
		providerId,
		repositoryId,
	}: FindProviderParams): Promise<CheckStatusProviderView | undefined> {
		const [provider] = await this.db
			.select(PROVIDER_COLUMNS)
			.from(checkStatusProviders)
			.where(
				and(
					eq(checkStatusProviders.id, providerId),
					eq(checkStatusProviders.repositoryId, repositoryId)
				)
			)
			.limit(1)

		return provider
	}

	/**
	 * The repository one authenticated key may publish to, or nothing.
	 *
	 * A revoked credential resolves to nothing rather than to a repository it may
	 * not write to: revocation is recorded here as well as on the key, and this is
	 * the read that has to honour it.
	 */
	async findAuthorization(
		apiKeyId: ApiKeyId
	): Promise<CheckStatusCredentialAuthorization | undefined> {
		const [authorization] = await this.db
			.select({
				credentialId: checkStatusCredentials.id,
				providerId: checkStatusProviders.id,
				repositoryId: checkStatusProviders.repositoryId,
			})
			.from(checkStatusCredentials)
			.innerJoin(
				checkStatusProviders,
				eq(checkStatusProviders.id, checkStatusCredentials.providerId)
			)
			.where(
				and(
					eq(checkStatusCredentials.apiKeyId, apiKeyId),
					isNull(checkStatusCredentials.revokedAt)
				)
			)
			.limit(1)

		return authorization
	}

	/**
	 * A publisher and the first secret it may use, together or not at all. A
	 * provider with no credential can publish nothing, so leaving one behind
	 * after a failed second insert would just be litter an admin has to notice.
	 */
	async createProviderWithCredential({
		actorUserId,
		displayName,
		key,
		providerKey,
		repositoryId,
	}: CreateProviderWithCredentialParams): Promise<
		CreatedCheckStatusProvider | undefined
	> {
		return await this.db.transaction(async tx => {
			const [provider] = await tx
				.insert(checkStatusProviders)
				.values({
					repositoryId,
					key: providerKey,
					displayName,
					createdByUserId: actorUserId,
				})
				.returning(PROVIDER_COLUMNS)

			if (!provider) return undefined

			const credential = await this.insertCredential(tx, {
				actorUserId,
				key,
				provider,
				repositoryId,
			})

			return credential && { provider, credential }
		})
	}

	async createCredential({
		actorUserId,
		key,
		provider,
		repositoryId,
	}: CreateCredentialParams): Promise<CheckStatusCredentialView | undefined> {
		return await this.db.transaction(
			async tx =>
				await this.insertCredential(tx, {
					actorUserId,
					key,
					provider,
					repositoryId,
				})
		)
	}

	private async insertCredential(
		db: DrizzleTransaction,
		{ actorUserId, key, provider, repositoryId }: CreateCredentialParams
	): Promise<CheckStatusCredentialView | undefined> {
		const [credential] = await db
			.insert(checkStatusCredentials)
			.values({
				providerId: provider.id,
				apiKeyId: key.id,
				createdByUserId: actorUserId,
			})
			.returning({
				id: checkStatusCredentials.id,
				providerId: checkStatusCredentials.providerId,
				apiKeyId: checkStatusCredentials.apiKeyId,
				revokedAt: checkStatusCredentials.revokedAt,
				createdAt: checkStatusCredentials.createdAt,
			})

		if (!credential) return undefined

		await this.createEvent(db, {
			repositoryId,
			actorUserId,
			type: 'check_status_credential_created',
			payload: {
				type: 'check_status_credential_created',
				providerId: provider.id,
				providerKey: provider.key,
				credentialId: credential.id,
			},
		})

		return {
			...credential,
			start: key.start,
			expiresAt: key.expiresAt,
			// The key was minted moments ago by the caller that is about to hand it
			// over; nothing has disabled or used it yet.
			enabled: true,
			lastUsedAt: null,
		}
	}

	async revokeCredential({
		actorUserId,
		credentialId,
		repositoryId,
	}: RevokeCredentialParams): Promise<RevokeCheckStatusCredentialResult> {
		return await this.db.transaction(async tx => {
			// The lock makes a double revoke a decision rather than a race: the second
			// caller waits and then reads the revocation the first one wrote.
			const [existing] = await tx
				.select({
					id: checkStatusCredentials.id,
					providerId: checkStatusProviders.id,
					providerKey: checkStatusProviders.key,
					revokedAt: checkStatusCredentials.revokedAt,
					apiKeyId: checkStatusCredentials.apiKeyId,
					createdByUserId: checkStatusCredentials.createdByUserId,
				})
				.from(checkStatusCredentials)
				.innerJoin(
					checkStatusProviders,
					eq(checkStatusProviders.id, checkStatusCredentials.providerId)
				)
				.where(
					and(
						eq(checkStatusCredentials.id, credentialId),
						eq(checkStatusProviders.repositoryId, repositoryId)
					)
				)
				.for('update', { of: checkStatusCredentials })

			if (!existing) return { status: 'not_found' }

			if (existing.revokedAt)
				return {
					status: 'already_revoked',
					apiKeyId: existing.apiKeyId,
					createdByUserId: existing.createdByUserId,
				}

			await tx
				.update(checkStatusCredentials)
				.set({ revokedAt: new Date() })
				.where(eq(checkStatusCredentials.id, existing.id))

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'check_status_credential_revoked',
				payload: {
					type: 'check_status_credential_revoked',
					providerId: existing.providerId,
					providerKey: existing.providerKey,
					credentialId: existing.id,
				},
			})

			return {
				status: 'revoked',
				apiKeyId: existing.apiKeyId,
				createdByUserId: existing.createdByUserId,
			}
		})
	}

	private async createEvent(
		db: DrizzleTransaction,
		params: {
			repositoryId: RepositoryId
			actorUserId: UserId
			type: RepositoryEvent['type']
			payload: RepositoryEventPayload
		}
	) {
		await db.insert(repositoryEvents).values(params)
	}
}
