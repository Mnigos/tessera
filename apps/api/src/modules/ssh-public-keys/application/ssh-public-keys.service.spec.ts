import { Test, type TestingModule } from '@nestjs/testing'
import type { SshPublicKey } from '@repo/db'
import type { SshPublicKeyId, UserId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	DuplicateSshPublicKeyError,
	InvalidSshPublicKeyError,
	SshPublicKeyNotFoundError,
} from '../domain/ssh-public-key.errors'
import { SshPublicKeysRepository } from '../infrastructure/ssh-public-keys.repository'
import { SshPublicKeysService } from './ssh-public-keys.service'

const createdAt = new Date('2026-05-12T00:00:00Z')
const otherUserId = '00000000-0000-4000-8000-000000000099' as UserId
const sshPublicKeyId = '00000000-0000-4000-8000-000000000021' as SshPublicKeyId
const publicKey =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA marta@laptop'

const sshPublicKey: SshPublicKey = {
	id: sshPublicKeyId,
	ownerUserId: mockUserId,
	title: 'Laptop',
	keyType: 'ssh-ed25519',
	publicKey,
	fingerprintSha256: 'SHA256:kmYcvdi2GkPeWxB6XLjrZB8JHsy2Hm8luHMFp9GMvqk',
	comment: 'marta@laptop',
	createdAt,
	updatedAt: createdAt,
}

describe(SshPublicKeysService.name, () => {
	let moduleRef: TestingModule
	let sshPublicKeysService: SshPublicKeysService
	let sshPublicKeysRepository: SshPublicKeysRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				SshPublicKeysService,
				{
					provide: SshPublicKeysRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						findOwned: vi.fn(),
						delete: vi.fn(),
					},
				},
			],
		}).compile()

		sshPublicKeysService = moduleRef.get(SshPublicKeysService)
		sshPublicKeysRepository = moduleRef.get(SshPublicKeysRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a normalized SSH public key for the owner', async () => {
		const createSpy = vi
			.spyOn(sshPublicKeysRepository, 'create')
			.mockResolvedValue(sshPublicKey)

		expect(
			await sshPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey: `  ${publicKey}  `,
			})
		).toEqual({
			id: sshPublicKey.id,
			title: 'Laptop',
			keyType: 'ssh-ed25519',
			publicKey,
			fingerprintSha256: sshPublicKey.fingerprintSha256,
			comment: 'marta@laptop',
			createdAt,
			updatedAt: createdAt,
		})
		expect(createSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			title: 'Laptop',
			keyType: 'ssh-ed25519',
			publicKey,
			fingerprintSha256: sshPublicKey.fingerprintSha256,
			comment: 'marta@laptop',
		})
	})

	test('lists only keys returned for the requesting owner', async () => {
		const listSpy = vi
			.spyOn(sshPublicKeysRepository, 'list')
			.mockResolvedValue([sshPublicKey])

		expect(await sshPublicKeysService.list(mockUserId)).toEqual([
			expect.objectContaining({
				id: sshPublicKey.id,
				title: 'Laptop',
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({ userId: mockUserId })
	})

	test('rejects invalid SSH public keys', async () => {
		await expect(
			sshPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey: 'not-a-key',
			})
		).rejects.toThrow(InvalidSshPublicKeyError)
	})

	test('maps duplicate fingerprints to a domain conflict', async () => {
		vi.spyOn(sshPublicKeysRepository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'ssh_public_keys_owner_fingerprint_unique',
		})

		await expect(
			sshPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey,
			})
		).rejects.toThrow(DuplicateSshPublicKeyError)
	})

	test('deletes keys only after finding ownership', async () => {
		const findOwnedSpy = vi
			.spyOn(sshPublicKeysRepository, 'findOwned')
			.mockResolvedValue(sshPublicKey)
		const deleteSpy = vi
			.spyOn(sshPublicKeysRepository, 'delete')
			.mockResolvedValue(undefined)

		await sshPublicKeysService.delete(mockUserId, sshPublicKeyId)

		expect(findOwnedSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			sshPublicKeyId,
		})
		expect(deleteSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			sshPublicKeyId,
		})
	})

	test('rejects deleting another users key', async () => {
		vi.spyOn(sshPublicKeysRepository, 'findOwned').mockResolvedValue(undefined)

		await expect(
			sshPublicKeysService.delete(otherUserId, sshPublicKeyId)
		).rejects.toThrow(SshPublicKeyNotFoundError)
		expect(sshPublicKeysRepository.delete).not.toHaveBeenCalled()
	})
})
