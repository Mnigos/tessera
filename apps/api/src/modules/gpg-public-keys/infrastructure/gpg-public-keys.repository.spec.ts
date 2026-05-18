import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, eq, gpgPublicKeys } from '@repo/db'
import type { GpgPublicKeyId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { GpgPublicKeysRepository } from './gpg-public-keys.repository'

const gpgPublicKeyId = '00000000-0000-4000-8000-000000000024' as GpgPublicKeyId
const keyCreatedAt = new Date('2024-01-02T03:04:05Z')

describe(GpgPublicKeysRepository.name, () => {
	let moduleRef: TestingModule
	let gpgPublicKeysRepository: GpgPublicKeysRepository

	const findManyMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const returningMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const deleteReturningMock = vi.fn()

	beforeEach(async () => {
		returningMock.mockResolvedValue([{ title: 'Laptop' }])
		valuesMock.mockReturnValue({ returning: returningMock })
		insertMock.mockReturnValue({ values: valuesMock })
		deleteReturningMock.mockResolvedValue([{ id: gpgPublicKeyId }])
		deleteWhereMock.mockReturnValue({ returning: deleteReturningMock })
		deleteMock.mockReturnValue({ where: deleteWhereMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				GpgPublicKeysRepository,
				{
					provide: Database,
					useValue: {
						query: {
							gpgPublicKeys: {
								findMany: findManyMock,
							},
						},
						insert: insertMock,
						delete: deleteMock,
					},
				},
			],
		}).compile()

		gpgPublicKeysRepository = moduleRef.get(GpgPublicKeysRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates an owner-scoped GPG public key row', async () => {
		expect(
			await gpgPublicKeysRepository.create({
				userId: mockUserId,
				title: 'Laptop',
				publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
				fingerprint: 'F4574880B5D7FB64AB70B24A3C1630334B9A4120',
				keyId: '3C1630334B9A4120',
				identities: [{ userId: 'Marta <marta@example.com>' }],
				emails: ['marta@example.com'],
				keyCreatedAt,
				keyExpiresAt: undefined,
				isRevoked: false,
			})
		).toEqual({ title: 'Laptop' })
		expect(insertMock).toHaveBeenCalledWith(gpgPublicKeys)
		expect(valuesMock).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			title: 'Laptop',
			publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
			fingerprint: 'F4574880B5D7FB64AB70B24A3C1630334B9A4120',
			keyId: '3C1630334B9A4120',
			identities: [{ userId: 'Marta <marta@example.com>' }],
			emails: ['marta@example.com'],
			keyCreatedAt,
			keyExpiresAt: undefined,
			isRevoked: false,
		})
		expect(returningMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: gpgPublicKeys.id,
				ownerUserId: gpgPublicKeys.ownerUserId,
				fingerprint: gpgPublicKeys.fingerprint,
				lastUsedAt: gpgPublicKeys.lastUsedAt,
			})
		)
	})

	test('lists keys owned by the user', async () => {
		findManyMock.mockResolvedValue([{ title: 'Laptop' }])

		expect(await gpgPublicKeysRepository.list({ userId: mockUserId })).toEqual([
			{ title: 'Laptop' },
		])
		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: eq(gpgPublicKeys.ownerUserId, mockUserId),
			})
		)
	})

	test('deletes a key by id and owner', async () => {
		expect(
			await gpgPublicKeysRepository.delete({
				userId: mockUserId,
				gpgPublicKeyId,
			})
		).toBe(gpgPublicKeyId)

		expect(deleteMock).toHaveBeenCalledWith(gpgPublicKeys)
		expect(deleteWhereMock).toHaveBeenCalledWith(
			and(
				eq(gpgPublicKeys.id, gpgPublicKeyId),
				eq(gpgPublicKeys.ownerUserId, mockUserId)
			)
		)
		expect(deleteReturningMock).toHaveBeenCalledWith({ id: gpgPublicKeys.id })
	})

	test('returns undefined when no owned key is deleted', async () => {
		deleteReturningMock.mockResolvedValue([])

		expect(
			await gpgPublicKeysRepository.delete({
				userId: mockUserId,
				gpgPublicKeyId,
			})
		).toBeUndefined()
	})
})
