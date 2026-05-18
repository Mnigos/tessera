import { Test, type TestingModule } from '@nestjs/testing'
import type { GpgPublicKey } from '@repo/db'
import type { GpgPublicKeyId, UserId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	DuplicateGpgPublicKeyError,
	GpgPublicKeyNotFoundError,
	InvalidGpgPublicKeyError,
} from '../domain/gpg-public-key.errors'
import { GpgPublicKeysRepository } from '../infrastructure/gpg-public-keys.repository'
import { GpgPublicKeysService } from './gpg-public-keys.service'

const createdAt = new Date('2026-05-12T00:00:00Z')
const keyCreatedAt = new Date('2024-01-02T03:04:05Z')
const keyExpiresAt = new Date('2024-01-03T03:04:05Z')
const otherUserId = '00000000-0000-4000-8000-000000000099' as UserId
const gpgPublicKeyId = '00000000-0000-4000-8000-000000000024' as GpgPublicKeyId
const publicKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xjMEZZN9JRYJKwYBBAHaRw8BAQdAJHJGXb7Vwj5XXgHDpZ9Ww4pHrGgPZvpy
Wtiv0TahrobNGU1hcnRhIDxtYXJ0YUBleGFtcGxlLmNvbT7CwBkEExYKAIsF
gmWTfSUFiQABUYADCwkHCRA8FjAzS5pBIEUUAAAAAAAcACBzYWx0QG5vdGF0
aW9ucy5vcGVucGdwanMub3Jnh3D6OSc2gJHgR+nnUvzFI7BAve9b4xXwtlii
lby4HbgFFQoIDgwEFgACAQIZAQKbAwIeARYhBPRXSIC11/tkq3CySjwWMDNL
mkEgAAAcoQD/SHzvzBC3TaJ9ClbyXsTuGcppZw9vzDhHV+JA2BPajr0BAJ9s
E0L/LJylembht1HU8n8CDBWS7Apucuwa5iOof1AEzjgEZZN9JRIKKwYBBAGX
VQEFAQEHQN6GoGeIS4MgPnHK5Ii9K3lsKPRmBUNPfOeBMIyttsUSAwEIB8LA
BAQYFgoAdgWCZZN9JQWJAAFRgAkQPBYwM0uaQSBFFAAAAAAAHAAgc2FsdEBu
b3RhdGlvbnMub3BlbnBncGpzLm9yZ3VTF8yhWqyZZULIxB6W4kGvR7oa3qhw
GLv+3bchD7WDApsMFiEE9FdIgLXX+2SrcLJKPBYwM0uaQSAAACCYAQCwGDGv
VFJXrA3WiLArUw4uNrIHcobxf+7WzP15VAKsgwD9H82orGKcwVLrAS6fz7gX
HY2leIkGDbvNcJ5VayBkyQ4=
=fhBZ
-----END PGP PUBLIC KEY BLOCK-----`

const gpgPublicKey: GpgPublicKey = {
	id: gpgPublicKeyId,
	ownerUserId: mockUserId,
	title: 'Laptop',
	publicKey: `${publicKey}\n`,
	fingerprint: 'F4574880B5D7FB64AB70B24A3C1630334B9A4120',
	keyId: '3C1630334B9A4120',
	identities: [
		{
			name: 'Marta',
			email: 'marta@example.com',
			userId: 'Marta <marta@example.com>',
			comment: undefined,
		},
	],
	emails: ['marta@example.com'],
	keyCreatedAt,
	keyExpiresAt,
	isRevoked: false,
	lastUsedAt: null,
	createdAt,
	updatedAt: createdAt,
}

describe(GpgPublicKeysService.name, () => {
	let moduleRef: TestingModule
	let gpgPublicKeysService: GpgPublicKeysService
	let gpgPublicKeysRepository: GpgPublicKeysRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GpgPublicKeysService,
				{
					provide: GpgPublicKeysRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						delete: vi.fn(),
					},
				},
			],
		}).compile()

		gpgPublicKeysService = moduleRef.get(GpgPublicKeysService)
		gpgPublicKeysRepository = moduleRef.get(GpgPublicKeysRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a normalized GPG public key for the owner', async () => {
		const createSpy = vi
			.spyOn(gpgPublicKeysRepository, 'create')
			.mockResolvedValue(gpgPublicKey)

		expect(
			await gpgPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey: `  ${publicKey}  `,
			})
		).toEqual({
			id: gpgPublicKey.id,
			title: 'Laptop',
			publicKey: `${publicKey}\n`,
			fingerprint: gpgPublicKey.fingerprint,
			keyId: gpgPublicKey.keyId,
			identities: gpgPublicKey.identities,
			emails: ['marta@example.com'],
			keyCreatedAt,
			keyExpiresAt,
			isRevoked: false,
			lastUsedAt: undefined,
			createdAt,
			updatedAt: createdAt,
		})
		expect(createSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			title: 'Laptop',
			publicKey: `${publicKey}\n`,
			fingerprint: gpgPublicKey.fingerprint,
			keyId: gpgPublicKey.keyId,
			identities: gpgPublicKey.identities,
			emails: ['marta@example.com'],
			keyCreatedAt,
			keyExpiresAt,
			isRevoked: false,
		})
	})

	test('lists only keys returned for the requesting owner', async () => {
		const listSpy = vi
			.spyOn(gpgPublicKeysRepository, 'list')
			.mockResolvedValue([gpgPublicKey])

		expect(await gpgPublicKeysService.list(mockUserId)).toEqual([
			expect.objectContaining({
				id: gpgPublicKey.id,
				title: 'Laptop',
				lastUsedAt: undefined,
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({ userId: mockUserId })
	})

	test('rejects invalid GPG public keys', async () => {
		await expect(
			gpgPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey: 'not-a-key',
			})
		).rejects.toThrow(InvalidGpgPublicKeyError)
	})

	test('maps duplicate fingerprints to a domain conflict', async () => {
		vi.spyOn(gpgPublicKeysRepository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'gpg_public_keys_owner_fingerprint_unique',
		})

		await expect(
			gpgPublicKeysService.create(mockUserId, {
				title: 'Laptop',
				publicKey,
			})
		).rejects.toThrow(DuplicateGpgPublicKeyError)
	})

	test('deletes keys scoped by owner', async () => {
		const deleteSpy = vi
			.spyOn(gpgPublicKeysRepository, 'delete')
			.mockResolvedValue(gpgPublicKeyId)

		await gpgPublicKeysService.delete(mockUserId, gpgPublicKeyId)

		expect(deleteSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			gpgPublicKeyId,
		})
	})

	test('rejects deleting another users key', async () => {
		vi.spyOn(gpgPublicKeysRepository, 'delete').mockResolvedValue(undefined)

		await expect(
			gpgPublicKeysService.delete(otherUserId, gpgPublicKeyId)
		).rejects.toThrow(GpgPublicKeyNotFoundError)
		expect(gpgPublicKeysRepository.delete).toHaveBeenCalledWith({
			userId: otherUserId,
			gpgPublicKeyId,
		})
	})
})
