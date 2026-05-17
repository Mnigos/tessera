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

	beforeEach(async () => {
		returningMock.mockResolvedValue([{ title: 'Laptop' }])
		valuesMock.mockReturnValue({ returning: returningMock })
		insertMock.mockReturnValue({ values: valuesMock })
		deleteMock.mockReturnValue({ where: deleteWhereMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				SshPublicKeysRepository,
				{
					provide: Database,
					useValue: {
						query: {
							sshPublicKeys: {
								findMany: findManyMock,
								findFirst: findFirstMock,
							},
						},
						insert: insertMock,
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
				fingerprintSha256: 'SHA256:abc',
				comment: 'marta@laptop',
			})
		).toEqual({ title: 'Laptop' })
		expect(insertMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(valuesMock).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			title: 'Laptop',
			keyType: 'ssh-ed25519',
			publicKey: 'ssh-ed25519 AAAA marta@laptop',
			fingerprintSha256: 'SHA256:abc',
			comment: 'marta@laptop',
		})
		expect(returningMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: sshPublicKeys.id,
				ownerUserId: sshPublicKeys.ownerUserId,
				fingerprintSha256: sshPublicKeys.fingerprintSha256,
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

	test('finds a key by id and owner', async () => {
		findFirstMock.mockResolvedValue({ title: 'Laptop' })

		expect(
			await sshPublicKeysRepository.findOwned({
				userId: mockUserId,
				sshPublicKeyId,
			})
		).toEqual({ title: 'Laptop' })
		expect(findFirstMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: and(
					eq(sshPublicKeys.id, sshPublicKeyId),
					eq(sshPublicKeys.ownerUserId, mockUserId)
				),
			})
		)
	})

	test('deletes a key by id and owner', async () => {
		await sshPublicKeysRepository.delete({
			userId: mockUserId,
			sshPublicKeyId,
		})

		expect(deleteMock).toHaveBeenCalledWith(sshPublicKeys)
		expect(deleteWhereMock).toHaveBeenCalledWith(
			and(
				eq(sshPublicKeys.id, sshPublicKeyId),
				eq(sshPublicKeys.ownerUserId, mockUserId)
			)
		)
	})
})
