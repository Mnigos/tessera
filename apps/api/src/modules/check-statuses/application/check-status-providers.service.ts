import { RepositoriesService } from '@modules/repositories'
import { Injectable, Logger } from '@nestjs/common'
import {
	type Auth,
	CHECK_STATUS_CREDENTIAL_CONFIG_ID,
	CHECK_STATUS_CREDENTIAL_PREFIX,
	getCheckStatusCredentialPermission,
} from '@repo/auth'
import type {
	CheckStatusProvider,
	CreatedCheckStatusCredential,
	ParsedCreateCheckStatusCredentialInput,
	ParsedCreateCheckStatusProviderInput,
	ParsedListCheckStatusProvidersInput,
	ParsedRevokeCheckStatusCredentialInput,
} from '@repo/contracts'
import type { ApiKeyId, RepositoryId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	CheckStatusCredentialCreateFailedError,
	CheckStatusCredentialNotFoundError,
	CheckStatusPermissionDeniedError,
	CheckStatusProviderAlreadyExistsError,
	CheckStatusProviderCreateFailedError,
	CheckStatusProviderNotFoundError,
	InvalidCheckStatusCredentialError,
} from '../domain/check-status-credential.errors'
import {
	type CheckStatusCredentialView,
	CheckStatusProvidersRepository,
	type CheckStatusProviderView,
	type CreatedCheckStatusProvider,
	type MintedApiKey,
} from '../infrastructure/check-status-providers.repository'

const CHECK_STATUS_PROVIDER_UNIQUE_CONSTRAINTS = new Set([
	'check_status_providers_repository_key_unique',
])

@Injectable()
export class CheckStatusProvidersService {
	private readonly logger = new Logger(CheckStatusProvidersService.name)

	constructor(
		private readonly betterAuthService: BetterAuthService<Auth>,
		private readonly checkStatusProvidersRepository: CheckStatusProvidersRepository,
		private readonly repositoriesService: RepositoriesService
	) {}

	async list(
		viewerUserId: UserId,
		{ slug, username }: ParsedListCheckStatusProvidersInput
	): Promise<{ providers: CheckStatusProvider[] }> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const [providers, credentials] = await Promise.all([
			this.checkStatusProvidersRepository.listProviders({ repositoryId }),
			this.checkStatusProvidersRepository.listCredentials({ repositoryId }),
		])
		const credentialsByProvider = Map.groupBy(
			credentials,
			credential => credential.providerId
		)

		return {
			providers: providers.map(provider =>
				toCheckStatusProviderOutput(
					provider,
					credentialsByProvider.get(provider.id) ?? []
				)
			),
		}
	}

	/**
	 * Registers a publisher and issues its first secret in one step. A provider
	 * with no credential can publish nothing, so the two are never worth creating
	 * apart.
	 */
	async createProvider(
		actorUserId: UserId,
		{
			displayName,
			expiresIn,
			key,
			slug,
			username,
		}: ParsedCreateCheckStatusProviderInput
	): Promise<CreatedCheckStatusCredential> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)

		// The key is minted first because the credential row has to name it, and a
		// key no row ever pointed at authorizes nothing: the guard resolves a
		// caller through the credential, so a duplicate key left behind by the
		// rollback below is inert rather than dangerous.
		const mintedKey = await this.createApiKey(
			actorUserId,
			displayName,
			expiresIn
		)

		try {
			const created =
				await this.checkStatusProvidersRepository.createProviderWithCredential({
					actorUserId,
					key: mintedKey,
					repositoryId,
					providerKey: key,
					displayName,
				})

			if (!created)
				throw new CheckStatusProviderCreateFailedError({ repositoryId, key })

			this.logger.log(
				`Status provider ${created.provider.key} created on repository ${repositoryId} with credential ${created.credential.id}`
			)

			return toCreatedCredential(mintedKey.token, created)
		} catch (error) {
			if (isUniqueViolation(error, CHECK_STATUS_PROVIDER_UNIQUE_CONSTRAINTS))
				throw new CheckStatusProviderAlreadyExistsError({ repositoryId, key })

			throw error
		}
	}

	/**
	 * Rotation: a second live secret for a publisher that already has one, so the
	 * old secret can be retired after the new one is in place rather than before.
	 */
	async createCredential(
		actorUserId: UserId,
		{
			expiresIn,
			providerId,
			slug,
			username,
		}: ParsedCreateCheckStatusCredentialInput
	): Promise<CreatedCheckStatusCredential> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const provider = await this.checkStatusProvidersRepository.findProvider({
			providerId,
			repositoryId,
		})

		if (!provider)
			throw new CheckStatusProviderNotFoundError({ providerId, repositoryId })

		return await this.issueCredential({
			actorUserId,
			expiresIn,
			provider,
			repositoryId,
		})
	}

	async revokeCredential(
		actorUserId: UserId,
		{ credentialId, slug, username }: ParsedRevokeCheckStatusCredentialInput
	): Promise<{ revoked: boolean }> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const result = await this.checkStatusProvidersRepository.revokeCredential({
			actorUserId,
			credentialId,
			repositoryId,
		})

		if (result.status === 'not_found')
			throw new CheckStatusCredentialNotFoundError({
				credentialId,
				repositoryId,
			})

		// The row is what authorization reads, but a withdrawn secret should stop
		// authenticating at all rather than merely stop being trusted. Disabling
		// runs after the row is committed and can fail on its own, so it runs for
		// an already-revoked credential too: retrying the revocation is what
		// finishes a job that was interrupted halfway. A credential whose key is
		// already gone has nothing left to disable.
		if (result.apiKeyId)
			await this.disableApiKey(result.apiKeyId, result.createdByUserId)

		if (result.status === 'revoked')
			this.logger.log(
				`Status credential ${credentialId} revoked on repository ${repositoryId}`
			)

		// An already-revoked credential is the state the caller asked for, so
		// saying so again is success rather than a conflict to resolve.
		return { revoked: true }
	}

	/**
	 * The API key one bearer token stands for, or a refusal.
	 *
	 * Everything Better Auth knows how to reject — an unknown key, a disabled or
	 * expired one, a key without `checks:write` — is rejected here. What it cannot
	 * know is that a key belongs to this configuration at all, so the prefix is
	 * checked too: a Git token presented here must not be able to reach the
	 * repository lookup, let alone pass it.
	 */
	async verifyCredential(rawToken: string | undefined): Promise<ApiKeyId> {
		if (!rawToken)
			throw new InvalidCheckStatusCredentialError({ reason: 'missing_token' })

		if (!rawToken.startsWith(CHECK_STATUS_CREDENTIAL_PREFIX))
			throw new InvalidCheckStatusCredentialError({ reason: 'wrong_prefix' })

		const verifiedToken = await this.betterAuthService.api.verifyApiKey({
			body: {
				configId: CHECK_STATUS_CREDENTIAL_CONFIG_ID,
				key: rawToken,
				permissions: getCheckStatusCredentialPermission('checks:write'),
			},
		})

		if (!(verifiedToken.valid && verifiedToken.key))
			throw new InvalidCheckStatusCredentialError({
				reason: verifiedToken.error?.code ?? 'invalid_token',
			})

		// Asking for the permission and confirming the answer are separate acts:
		// the lookup finds a key by its hash, not by configuration, so a key from
		// elsewhere that satisfied the request has still not been checked.
		if (!hasChecksWritePermission(verifiedToken.key.permissions))
			throw new CheckStatusPermissionDeniedError({ reason: 'checks_write' })

		return verifiedToken.key.id as ApiKeyId
	}

	private async issueCredential({
		actorUserId,
		expiresIn,
		provider,
		repositoryId,
	}: {
		actorUserId: UserId
		expiresIn?: number
		provider: CheckStatusProviderView
		repositoryId: RepositoryId
	}): Promise<CreatedCheckStatusCredential> {
		const mintedKey = await this.createApiKey(
			actorUserId,
			provider.displayName,
			expiresIn
		)
		const credential =
			await this.checkStatusProvidersRepository.createCredential({
				actorUserId,
				key: mintedKey,
				provider,
				repositoryId,
			})

		if (!credential)
			throw new CheckStatusCredentialCreateFailedError({
				providerId: provider.id,
				repositoryId,
			})

		this.logger.log(
			`Status credential ${credential.id} issued for provider ${provider.key} on repository ${repositoryId}`
		)

		return toCreatedCredential(mintedKey.token, { provider, credential })
	}

	/**
	 * Retires the secret behind a credential that is already revoked in the
	 * ledger. A failure here is reported rather than swallowed — the caller sees
	 * it and retrying the revocation finishes the job — but it is named first,
	 * because the consequence is a withdrawn credential whose key still
	 * authenticates and nothing else would say which one.
	 */
	private async disableApiKey(apiKeyId: ApiKeyId, ownerUserId: UserId) {
		try {
			await this.betterAuthService.api.updateApiKey({
				body: {
					configId: CHECK_STATUS_CREDENTIAL_CONFIG_ID,
					keyId: apiKeyId,
					userId: ownerUserId,
					enabled: false,
				},
			})
		} catch (error) {
			this.logger.error(
				`Revoked status credential key ${apiKeyId} could not be disabled and is still live`,
				error
			)

			throw error
		}
	}

	private async createApiKey(
		actorUserId: UserId,
		name: string,
		expiresIn?: number
	): Promise<MintedApiKey & { token: string }> {
		const createdKey = await this.betterAuthService.api.createApiKey({
			body: {
				configId: CHECK_STATUS_CREDENTIAL_CONFIG_ID,
				userId: actorUserId,
				name,
				expiresIn,
				prefix: CHECK_STATUS_CREDENTIAL_PREFIX,
				permissions: getCheckStatusCredentialPermission('checks:write'),
			},
		})

		return {
			id: createdKey.id as ApiKeyId,
			start: createdKey.start ?? null,
			expiresAt: createdKey.expiresAt ?? null,
			token: createdKey.key,
		}
	}
}

/** The one response that carries the secret, and the only one that ever will. */
function toCreatedCredential(
	token: string,
	{ credential, provider }: CreatedCheckStatusProvider
): CreatedCheckStatusCredential {
	return {
		token,
		credential: toCheckStatusCredentialOutput(credential),
		provider: toCheckStatusProviderOutput(provider, [credential]),
	}
}

function hasChecksWritePermission(
	permissions?: Record<string, string[]> | null
): boolean {
	return permissions?.checks?.includes('write') ?? false
}

function toCheckStatusProviderOutput(
	{ createdAt, displayName, id, key, updatedAt }: CheckStatusProviderView,
	credentials: CheckStatusCredentialView[]
): CheckStatusProvider {
	return {
		id,
		key,
		displayName,
		credentials: credentials.map(toCheckStatusCredentialOutput),
		createdAt,
		updatedAt,
	}
}

function toCheckStatusCredentialOutput({
	createdAt,
	enabled,
	expiresAt,
	id,
	lastUsedAt,
	revokedAt,
	start,
}: CheckStatusCredentialView) {
	return {
		id,
		start: start ?? undefined,
		enabled: enabled ?? true,
		createdAt,
		revokedAt: revokedAt ?? undefined,
		expiresAt: expiresAt ?? undefined,
		lastUsedAt: lastUsedAt ?? undefined,
	}
}
