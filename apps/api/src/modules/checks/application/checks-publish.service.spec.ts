import { Test, type TestingModule } from '@nestjs/testing'
import type { ParsedPublishCommitStatusInput } from '@repo/contracts'
import type {
	CheckId,
	CheckObservationId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { CheckStatusIdempotencyConflictError } from '../domain/check-status.errors'
import {
	type CheckObservationRow,
	ChecksRepository,
} from '../infrastructure/checks.repository'
import { ChecksPublishService } from './checks-publish.service'

const checkId = '00000000-0000-4000-8000-000000000001' as CheckId
const observationId =
	'00000000-0000-4000-8000-000000000002' as CheckObservationId
const authorization = {
	credentialId:
		'00000000-0000-4000-8000-000000000003' as CheckStatusCredentialId,
	providerId: '00000000-0000-4000-8000-000000000004' as CheckStatusProviderId,
	repositoryId: '00000000-0000-4000-8000-000000000005' as RepositoryId,
}
const sha = 'a'.repeat(40)

describe(ChecksPublishService.name, () => {
	let moduleRef: TestingModule
	let service: ChecksPublishService
	let checksRepository: ChecksRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				ChecksPublishService,
				{
					provide: ChecksRepository,
					useValue: {
						publishStatusObservation: vi
							.fn()
							.mockResolvedValue({ status: 'appended', checkId }),
					},
				},
			],
		}).compile()

		service = moduleRef.get(ChecksPublishService)
		checksRepository = moduleRef.get(ChecksRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('files the report under the credential’s own provider stream', async () => {
		const result = await service.publishStatus(authorization, input())

		expect(checksRepository.publishStatusObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: authorization.repositoryId,
				sha,
				context: 'ci/build',
				providerId: authorization.providerId,
				observation: expect.objectContaining({
					state: 'success',
					credentialId: authorization.credentialId,
					// The caller's key, namespaced so it can never collide with the
					// content fingerprints an import writes.
					fingerprint: 'published:build-42',
				}),
			})
		)
		expect(result).toMatchObject({ checkId, sha, state: 'success' })
		expect(result.created).toBeTruthy()
	})

	test('keeps the pull request’s own timestamps apart', async () => {
		const reportedAt = new Date('2026-08-08T09:00:00Z')

		await service.publishStatus(authorization, input({ reportedAt }))

		const [params] = vi.mocked(checksRepository.publishStatusObservation).mock
			.calls[0] ?? [undefined]

		expect(params?.observation.providerCreatedAt).toBe(reportedAt)
		// When Tessera heard it, which is never the publisher's to decide.
		expect(params?.observation.observedAt).toBeInstanceOf(Date)
	})

	test('answers a retry of the same report without recording it twice', async () => {
		const recorded = observationRow({ state: 'success' })
		mockDuplicate(recorded, recorded)

		const result = await service.publishStatus(authorization, input())

		expect(result.created).toBeFalsy()
		expect(result.state).toBe('success')
		expect(result.observedAt).toBe(recorded.observedAt)
	})

	test('answers a replay with where the context has got to since', async () => {
		// The key recorded a success the stream has moved past. Echoing it back
		// would tell CI that a context which has since failed had un-failed.
		const recorded = observationRow({ state: 'success' })
		const newest = observationRow({
			state: 'failure',
			observedAt: new Date('2026-08-08T12:00:00Z'),
		})
		mockDuplicate(recorded, newest)

		const result = await service.publishStatus(authorization, input())

		expect(result.created).toBeFalsy()
		expect(result.state).toBe('failure')
		expect(result.observedAt).toBe(newest.observedAt)
	})

	test('refuses a key reused for a different report', async () => {
		const recorded = observationRow({ state: 'failure' })
		mockDuplicate(recorded, recorded)

		await expect(
			service.publishStatus(authorization, input())
		).rejects.toBeInstanceOf(CheckStatusIdempotencyConflictError)
	})

	test('counts every supplied field as part of what the key recorded', async () => {
		const recorded = observationRow({
			state: 'success',
			description: 'All green',
		})
		mockDuplicate(recorded, recorded)

		await expect(
			service.publishStatus(
				authorization,
				input({ description: 'Mostly green' })
			)
		).rejects.toBeInstanceOf(CheckStatusIdempotencyConflictError)
	})

	test('treats a vanished duplicate as a conflict rather than a silent drop', async () => {
		// Nothing in an append-only ledger can conflict and then not be there, so
		// answering success would claim a write that did not happen.
		mockDuplicate(undefined, undefined)

		await expect(
			service.publishStatus(authorization, input())
		).rejects.toBeInstanceOf(CheckStatusIdempotencyConflictError)
	})

	function mockDuplicate(
		recorded?: CheckObservationRow,
		effective?: CheckObservationRow
	) {
		vi.spyOn(checksRepository, 'publishStatusObservation').mockResolvedValue({
			status: 'duplicate',
			checkId,
			recorded,
			effective,
		})
	}
})

function input(
	overrides: Partial<ParsedPublishCommitStatusInput> = {}
): ParsedPublishCommitStatusInput {
	return {
		username: 'marta',
		slug: 'notes' as RepositorySlug,
		sha,
		context: 'ci/build',
		state: 'success',
		idempotencyKey: 'build-42',
		...overrides,
	}
}

function observationRow(
	overrides: Partial<CheckObservationRow> = {}
): CheckObservationRow {
	return {
		id: observationId,
		state: 'success',
		targetUrl: null,
		description: null,
		providerCreatedAt: null,
		observedAt: new Date('2026-08-08T10:00:00Z'),
		...overrides,
	}
}
