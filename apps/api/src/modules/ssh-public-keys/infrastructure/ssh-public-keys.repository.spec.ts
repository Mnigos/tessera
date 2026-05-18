import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, eq, sshPublicKeys } from '@repo/db'
import type { SshPublicKeyId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { SshPublicKeysRepository } from './ssh-public-keys.repository'

const sshPublicKeyId = '00000000-0000-4000-8000-000000000021' as SshPublicKeyId

describe(SshPublicKeysRepository.name, () => {
	let moduleRef: TestingModule
	let sshPublicKeysRepository: SshPublicKeysRepository

	const findManyMock = vi.fn()
	const findFirstMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const returningMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const deleteReturningMock = vi.fn()
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const updateWhereMock = vi.fn()

	beforeEach(async () => {
		returningMock.mockResolvedValue([{ title: 'Laptop' }])
		valuesMock.mockReturnValue({ returning: returningMock })
		insertMock.mockReturnValue({ values: valuesMock })
		deleteReturningMock.mockResolvedValue([{ id: sshPublicKeyId }])
		deleteWhereMock.mockReturnValue({ returning: deleteReturningMock })
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		updateWhereMock.mockResolvedValue(undefined)
		setMock.mockReturnValue({ where: updateWhereMock })
		updateMock.mockReturnValue({ set: setMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				SshPublicKeysRepository,
				{
					provide: Database,
					useValue: {
						query: {
							sshPublicKeys: {
								findFirst: findFirstMock,
								findMany: findManyMock,
							},
						},
						insert: insertMock,
						update: updateMock,
						delete: deleteMock,
					},
				},
			],
		}).compile()

		sshPublicKeysRepository = moduleRef.get(SshPublicKeysRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates an owner-scoped SSH public key row', async () => {
		expect(
			await sshPublicKeysRepository.create({
				userId: mockUserId,
				title: 'Laptop',
				keyType: 'ssh-ed25519',
				publicKey: 'ssh-ed25519 AAAA marta@laptop',
				fingerprint: 'SHA256:abc',
				comment: 'marta@laptop',
			})
		).toEqual({ title: 'Laptop' })
		expect(insertMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(valuesMock).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			title: 'Laptop',
			keyType: 'ssh-ed25519',
			publicKey: 'ssh-ed25519 AAAA marta@laptop',
			fingerprint: 'SHA256:abc',
			comment: 'marta@laptop',
		})
		expect(returningMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: sshPublicKeys.id,
				ownerUserId: sshPublicKeys.ownerUserId,
				fingerprint: sshPublicKeys.fingerprint,
				lastUsedAt: sshPublicKeys.lastUsedAt,
			})
		)
	})

	test('lists keys owned by the user', async () => {
		findManyMock.mockResolvedValue([{ title: 'Laptop' }])

		expect(await sshPublicKeysRepository.list({ userId: mockUserId })).toEqual([
			{ title: 'Laptop' },
		])
		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: eq(sshPublicKeys.ownerUserId, mockUserId),
			})
		)
	})

	test('finds a key by fingerprint', async () => {
		findFirstMock.mockResolvedValue({ title: 'Laptop' })

		expect(
			await sshPublicKeysRepository.findByFingerprint({
				fingerprint: 'SHA256:abc',
			})
		).toEqual({ title: 'Laptop' })
		expect(findFirstMock).toHaveBeenCalledWith({
			where: eq(sshPublicKeys.fingerprint, 'SHA256:abc'),
		})
	})

	test('records usage by fingerprint', async () => {
		const before = Date.now()

		await sshPublicKeysRepository.recordUsageByFingerprint({
			fingerprint: 'SHA256:abc',
		})

		expect(updateMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(setMock).toHaveBeenCalledWith({
			lastUsedAt: expect.any(Date),
		})
		const [usageUpdate] = setMock.mock.calls[0] ?? []

		expect(usageUpdate).toEqual({
			lastUsedAt: expect.any(Date),
		})
		if (!usageUpdate?.lastUsedAt) throw new Error('Expected lastUsedAt update')
		expect(usageUpdate.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before)
		expect(updateWhereMock).toHaveBeenCalledWith(
			eq(sshPublicKeys.fingerprint, 'SHA256:abc')
		)
	})

	test('deletes a key by id and owner', async () => {
		expect(
			await sshPublicKeysRepository.delete({
				userId: mockUserId,
				sshPublicKeyId,
			})
		).toBe(sshPublicKeyId)

		expect(deleteMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(deleteWhereMock).toHaveBeenCalledWith(
			and(
				eq(sshPublicKeys.id, sshPublicKeyId),
				eq(sshPublicKeys.ownerUserId, mockUserId)
			)
		)
		expect(deleteReturningMock).toHaveBeenCalledWith({ id: sshPublicKeys.id })
	})

	test('returns undefined when no owned key is deleted', async () => {
		deleteReturningMock.mockResolvedValue([])

		expect(
			await sshPublicKeysRepository.delete({
				userId: mockUserId,
				sshPublicKeyId,
			})
		).toBeUndefined()

		expect(deleteMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(deleteWhereMock).toHaveBeenCalledWith(
			and(
				eq(sshPublicKeys.id, sshPublicKeyId),
				eq(sshPublicKeys.ownerUserId, mockUserId)
			)
		)
		expect(deleteReturningMock).toHaveBeenCalledWith({ id: sshPublicKeys.id })
	})
})
