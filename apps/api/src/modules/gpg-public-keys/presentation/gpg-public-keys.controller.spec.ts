import { Test, type TestingModule } from '@nestjs/testing'
import type { GpgPublicKey } from '@repo/contracts'
import type { GpgPublicKeyId } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { GpgPublicKeysService } from '../application/gpg-public-keys.service'
import { GpgPublicKeysController } from './gpg-public-keys.controller'

const session = createMockSession()
const gpgPublicKeyId = '00000000-0000-4000-8000-000000000024' as GpgPublicKeyId
const gpgPublicKey: GpgPublicKey = {
	id: gpgPublicKeyId,
	title: 'Laptop',
	publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
	fingerprint: 'F4574880B5D7FB64AB70B24A3C1630334B9A4120',
	keyId: '3C1630334B9A4120',
	identities: [{ userId: 'Marta <marta@example.com>' }],
	emails: ['marta@example.com'],
	keyCreatedAt: new Date('2024-01-02T03:04:05Z'),
	keyExpiresAt: undefined,
	isRevoked: false,
	lastUsedAt: undefined,
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

describe(GpgPublicKeysController.name, () => {
	let moduleRef: TestingModule
	let gpgPublicKeysController: GpgPublicKeysController
	let gpgPublicKeysService: GpgPublicKeysService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [GpgPublicKeysController],
			providers: [
				{
					provide: GpgPublicKeysService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						delete: vi.fn(),
					},
				},
			],
		}).compile()

		gpgPublicKeysController = moduleRef.get(GpgPublicKeysController)
		gpgPublicKeysService = moduleRef.get(GpgPublicKeysService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests to the service', async () => {
		const createSpy = vi
			.spyOn(gpgPublicKeysService, 'create')
			.mockResolvedValue(gpgPublicKey)

		expect(
			await gpgPublicKeysController.create(session)['~orpc'].handler({
				input: { title: 'Laptop', publicKey: gpgPublicKey.publicKey },
				context: {},
				path: ['gpgPublicKeys', 'create'],
				procedure: gpgPublicKeysController.create(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ gpgPublicKey })
		expect(createSpy).toHaveBeenCalledWith(mockUserId, {
			title: 'Laptop',
			publicKey: gpgPublicKey.publicKey,
		})
	})

	test('delegates list requests to the service', async () => {
		const listSpy = vi
			.spyOn(gpgPublicKeysService, 'list')
			.mockResolvedValue([gpgPublicKey])

		expect(
			await gpgPublicKeysController.list(session)['~orpc'].handler({
				input: undefined,
				context: {},
				path: ['gpgPublicKeys', 'list'],
				procedure: gpgPublicKeysController.list(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ gpgPublicKeys: [gpgPublicKey] })
		expect(listSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates delete requests to the service', async () => {
		const deleteSpy = vi.spyOn(gpgPublicKeysService, 'delete')

		expect(
			await gpgPublicKeysController.delete(session)['~orpc'].handler({
				input: { id: gpgPublicKey.id },
				context: {},
				path: ['gpgPublicKeys', 'delete'],
				procedure: gpgPublicKeysController.delete(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ success: true })
		expect(deleteSpy).toHaveBeenCalledWith(mockUserId, gpgPublicKey.id)
	})
})
