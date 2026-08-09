import { RepositoriesService } from '@modules/repositories'
import type { ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	ApiKeyId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import type { AppRequest } from '~/shared/types/app-request'
import { CheckStatusProvidersService } from '../application/check-status-providers.service'
import { InvalidCheckStatusCredentialError } from '../domain/check-status-credential.errors'
import { CheckStatusProvidersRepository } from '../infrastructure/check-status-providers.repository'
import { getCheckStatusAuthorization } from './check-status-authorization.context'
import { CheckStatusPublishGuard } from './check-status-publish.guard'

const apiKeyId = '00000000-0000-4000-8000-000000000001' as ApiKeyId
const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const otherRepositoryId = '00000000-0000-4000-8000-000000000003' as RepositoryId
const authorization = {
	credentialId:
		'00000000-0000-4000-8000-000000000004' as CheckStatusCredentialId,
	providerId: '00000000-0000-4000-8000-000000000005' as CheckStatusProviderId,
	repositoryId,
}

describe(CheckStatusPublishGuard.name, () => {
	let moduleRef: TestingModule
	let guard: CheckStatusPublishGuard
	let providersService: CheckStatusProvidersService
	let providersRepository: CheckStatusProvidersRepository
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				CheckStatusPublishGuard,
				{
					provide: CheckStatusProvidersService,
					useValue: { verifyCredential: vi.fn() },
				},
				{
					provide: CheckStatusProvidersRepository,
					useValue: { findAuthorization: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: { findRepositoryTargetByPath: vi.fn() },
				},
			],
		}).compile()

		guard = moduleRef.get(CheckStatusPublishGuard)
		providersService = moduleRef.get(CheckStatusProvidersService)
		providersRepository = moduleRef.get(CheckStatusProvidersRepository)
		repositoriesService = moduleRef.get(RepositoriesService)

		vi.spyOn(providersService, 'verifyCredential').mockResolvedValue(apiKeyId)
		vi.spyOn(providersRepository, 'findAuthorization').mockResolvedValue(
			authorization
		)
		vi.spyOn(
			repositoriesService,
			'findRepositoryTargetByPath'
		).mockResolvedValue({ repositoryId, tesseraWritesAllowed: true })
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('admits a live credential to its own repository', async () => {
		const request = createRequest()

		expect(await guard.canActivate(createGuardContext(request))).toBeTruthy()
		expect(providersService.verifyCredential).toHaveBeenCalledWith(
			'tes_status_raw-secret'
		)
		expect(repositoriesService.findRepositoryTargetByPath).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes' as RepositorySlug,
			}
		)
		expect(getCheckStatusAuthorization(request)).toBe(authorization)
	})

	test('reads the token out of a bearer header whatever its casing', async () => {
		await guard.canActivate(
			createGuardContext(
				createRequest({ authorization: 'BEARER tes_status_raw-secret' })
			)
		)

		expect(providersService.verifyCredential).toHaveBeenCalledWith(
			'tes_status_raw-secret'
		)
	})

	test('refuses a request carrying no usable credential', async () => {
		const cases: Record<string, string>[] = [
			{},
			{ authorization: 'tes_status_raw-secret' },
			{ authorization: 'Basic dXNlcjpwYXNz' },
		]

		for (const headers of cases) {
			vi.spyOn(providersService, 'verifyCredential').mockRejectedValue(
				new InvalidCheckStatusCredentialError({ reason: 'missing_token' })
			)

			await expect(
				guard.canActivate(createGuardContext(createRequest(headers)))
			).rejects.toBeInstanceOf(InvalidCheckStatusCredentialError)
		}

		// Nothing that failed to authenticate ever reached the repository lookup.
		expect(
			repositoriesService.findRepositoryTargetByPath
		).not.toHaveBeenCalled()
	})

	test('refuses a credential the ledger no longer recognizes', async () => {
		// A revoked credential resolves to no authorization at all, so this is the
		// same refusal a key that was never issued gets.
		vi.spyOn(providersRepository, 'findAuthorization').mockResolvedValue(
			undefined
		)

		await expect(
			guard.canActivate(createGuardContext(createRequest()))
		).rejects.toBeInstanceOf(InvalidCheckStatusCredentialError)
	})

	test('refuses a credential aimed at another repository', async () => {
		vi.spyOn(providersRepository, 'findAuthorization').mockResolvedValue({
			...authorization,
			repositoryId: otherRepositoryId,
		})

		await expect(
			guard.canActivate(createGuardContext(createRequest()))
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('answers an unknown repository exactly as it answers somebody else’s', async () => {
		// Otherwise a valid credential becomes a way to discover which private
		// repositories exist by reading which refusal comes back.
		vi.spyOn(
			repositoriesService,
			'findRepositoryTargetByPath'
		).mockResolvedValue(undefined)

		await expect(
			guard.canActivate(createGuardContext(createRequest()))
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('refuses a repository GitHub is authoritative for', async () => {
		// Checks are an import there; a native write would sit beside GitHub's own
		// results claiming equal standing. Same refusal as a cross-repository
		// credential, so the answer reveals nothing about how the repository is
		// configured.
		vi.spyOn(
			repositoriesService,
			'findRepositoryTargetByPath'
		).mockResolvedValue({ repositoryId, tesseraWritesAllowed: false })

		await expect(
			guard.canActivate(createGuardContext(createRequest()))
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('refuses before authenticating when the path names no repository', async () => {
		await expect(
			guard.canActivate(
				createGuardContext({
					headers: { authorization: 'Bearer tes_status_raw-secret' },
					params: { username: 'marta' },
				} as unknown as AppRequest)
			)
		).rejects.toBeInstanceOf(InvalidCheckStatusCredentialError)
		expect(providersService.verifyCredential).not.toHaveBeenCalled()
	})
})

function createRequest(
	headers: Record<string, string> = {
		authorization: 'Bearer tes_status_raw-secret',
	}
): AppRequest {
	return {
		headers,
		params: { username: 'marta', slug: 'notes' },
	} as unknown as AppRequest
}

function createGuardContext(request: AppRequest): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => request }),
	} as ExecutionContext
}
