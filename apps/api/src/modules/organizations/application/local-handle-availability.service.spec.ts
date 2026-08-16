import { Test, type TestingModule } from '@nestjs/testing'
import type { OrganizationId } from '@repo/domain'
import { OrganizationHandlePolicyRepository } from '../infrastructure/organization-handle-policy.repository'
import { LocalHandleAvailabilityService } from './local-handle-availability.service'

describe(LocalHandleAvailabilityService.name, () => {
	let moduleRef: TestingModule
	let service: LocalHandleAvailabilityService
	let repository: OrganizationHandlePolicyRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				LocalHandleAvailabilityService,
				{
					provide: OrganizationHandlePolicyRepository,
					useValue: { isHandleTaken: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(LocalHandleAvailabilityService)
		repository = moduleRef.get(OrganizationHandlePolicyRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('checks the trimmed handle while excluding the organization being renamed', async () => {
		const organizationId =
			'00000000-0000-4000-8000-000000000010' as OrganizationId
		const isHandleTakenSpy = vi
			.spyOn(repository, 'isHandleTaken')
			.mockResolvedValue(true)

		expect(await service.isTaken('  Tessera  ', organizationId)).toBe(true)
		expect(isHandleTakenSpy).toHaveBeenCalledWith({
			handle: 'Tessera',
			ignoreOrganizationId: organizationId,
		})
	})
})
