import { Test, type TestingModule } from '@nestjs/testing'
import type { Organization, OrganizationMembership } from '@repo/contracts'
import type { OrganizationId } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import type { AppRequest } from '~/shared/types/app-request'
import { OrganizationsService } from '../application/organizations.service'
import { OrganizationsController } from './organizations.controller'

const session = createMockSession()
const organization: Organization = {
	id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	slug: 'tessera',
	name: 'Tessera',
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
}

describe(OrganizationsController.name, () => {
	let moduleRef: TestingModule
	let controller: OrganizationsController
	let organizationsService: OrganizationsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [OrganizationsController],
			providers: [
				{
					provide: OrganizationsService,
					useValue: {
						list: vi.fn(),
						create: vi.fn(),
						get: vi.fn(),
						update: vi.fn(),
						delete: vi.fn(),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(OrganizationsController)
		organizationsService = moduleRef.get(OrganizationsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates list and create requests for the signed-in user', async () => {
		const membership: OrganizationMembership = {
			...organization,
			role: 'owner',
		}
		vi.spyOn(organizationsService, 'list').mockResolvedValue([membership])
		vi.spyOn(organizationsService, 'create').mockResolvedValue(organization)

		expect(
			await controller
				.list(session)
				['~orpc'].handler({ input: undefined } as never)
		).toEqual({ organizations: [membership] })
		expect(
			await controller.create(session)['~orpc'].handler({
				input: { name: 'Tessera', slug: 'tessera' },
			} as never)
		).toEqual({ organization })
		expect(organizationsService.list).toHaveBeenCalledWith(mockUserId)
		expect(organizationsService.create).toHaveBeenCalledWith(mockUserId, {
			name: 'Tessera',
			slug: 'tessera',
		})
	})

	test('delegates get requests for the signed-in user', async () => {
		vi.spyOn(organizationsService, 'get').mockResolvedValue({
			organization,
			viewerRole: 'member',
		})

		expect(
			await controller.get(session)['~orpc'].handler({
				input: { organizationId: organization.id },
			} as never)
		).toEqual({ organization, viewerRole: 'member' })
	})

	test('forwards cookie headers on update without body metadata', async () => {
		vi.spyOn(organizationsService, 'update').mockResolvedValue(organization)
		const request = {
			headers: {
				cookie: 'better-auth.session_token=signed',
				'content-type': 'application/json',
			},
		} as unknown as AppRequest

		expect(
			await controller.update(request, session)['~orpc'].handler({
				input: { organizationId: organization.id, slug: 'tessera-next' },
			} as never)
		).toEqual({ organization })
		expect(organizationsService.update).toHaveBeenCalledWith(
			mockUserId,
			{ cookie: 'better-auth.session_token=signed' },
			{ organizationId: organization.id, slug: 'tessera-next' }
		)
	})

	test('delegates deletion and returns the contract literal', async () => {
		expect(
			await controller.delete(session)['~orpc'].handler({
				input: {
					organizationId: organization.id,
					confirmationSlug: 'tessera',
				},
			} as never)
		).toEqual({ deleted: true })
		expect(organizationsService.delete).toHaveBeenCalledWith(mockUserId, {
			organizationId: organization.id,
			confirmationSlug: 'tessera',
		})
	})
})
