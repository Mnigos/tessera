import { Test, type TestingModule } from '@nestjs/testing'
import type { CheckId, CheckObservationId, RepositoryId } from '@repo/domain'
import { ChecksRepository } from '../infrastructure/checks.repository'
import { ChecksProjectionService } from './checks-projection.service'

const repositoryId = '00000000-0000-4000-8000-000000000001' as RepositoryId
const checkId = '00000000-0000-4000-8000-000000000002' as CheckId
const observationId =
	'00000000-0000-4000-8000-000000000003' as CheckObservationId

describe(ChecksProjectionService.name, () => {
	let moduleRef: TestingModule
	let service: ChecksProjectionService
	let repository: ChecksRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				ChecksProjectionService,
				{
					provide: ChecksRepository,
					useValue: {
						ensureStatusCheck: vi.fn(),
						createCheckRun: vi.fn(),
						appendObservation: vi.fn(),
					},
				},
			],
		}).compile()
		service = moduleRef.get(ChecksProjectionService)
		repository = moduleRef.get(ChecksRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('reuses an existing provider run identity', async () => {
		expect(
			await service.resolveCheck({
				repositoryId,
				sha: 'head',
				kind: 'check_run',
				context: 'build',
				existingCheckId: checkId,
			})
		).toBe(checkId)
		expect(repository.createCheckRun).not.toHaveBeenCalled()
	})

	test('shares status streams but creates new check runs', async () => {
		vi.spyOn(repository, 'ensureStatusCheck').mockResolvedValue(checkId)
		vi.spyOn(repository, 'createCheckRun').mockResolvedValue(checkId)

		await service.resolveCheck({
			repositoryId,
			sha: 'head',
			kind: 'status',
			context: 'build',
		})
		await service.resolveCheck({
			repositoryId,
			sha: 'head',
			kind: 'check_run',
			context: 'build',
		})

		expect(repository.ensureStatusCheck).toHaveBeenCalledOnce()
		expect(repository.createCheckRun).toHaveBeenCalledOnce()
	})

	test('returns the repository idempotency result when appending', async () => {
		vi.spyOn(repository, 'appendObservation')
			.mockResolvedValueOnce(observationId)
			.mockResolvedValueOnce(undefined)
		const observation = {
			repositoryId,
			checkId,
			state: 'success' as const,
			observedAt: new Date('2026-08-08T10:00:00Z'),
			fingerprint: 'fingerprint',
		}

		expect(await service.appendObservation(observation)).toBe(observationId)
		expect(await service.appendObservation(observation)).toBeUndefined()
	})
})
