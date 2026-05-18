import { InvalidGpgPublicKeyError } from './gpg-public-key.errors'
import { normalizeGpgPublicKey } from './gpg-public-key.helpers'

const validGpgPublicKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

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

describe(normalizeGpgPublicKey.name, () => {
	test('normalizes armored public keys and extracts metadata', async () => {
		expect(await normalizeGpgPublicKey(`  ${validGpgPublicKey}  `)).toEqual({
			publicKey: `${validGpgPublicKey}\n`,
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
			keyCreatedAt: new Date('2024-01-02T03:04:05.000Z'),
			keyExpiresAt: new Date('2024-01-03T03:04:05.000Z'),
			isRevoked: false,
		})
	})

	test('rejects malformed armored keys', async () => {
		await expect(normalizeGpgPublicKey('not-a-key')).rejects.toThrow(
			InvalidGpgPublicKeyError
		)
	})

	test('rejects private keys before parsing', async () => {
		await expect(
			normalizeGpgPublicKey(`-----BEGIN PGP PRIVATE KEY BLOCK-----

abc
-----END PGP PRIVATE KEY BLOCK-----`)
		).rejects.toThrow(InvalidGpgPublicKeyError)
	})
})
