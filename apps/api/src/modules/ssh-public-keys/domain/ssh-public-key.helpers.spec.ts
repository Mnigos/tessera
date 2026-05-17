import { createHash, randomBytes } from 'node:crypto'
import { InvalidSshPublicKeyError } from './ssh-public-key.errors'
import { normalizeSshPublicKey } from './ssh-public-key.helpers'

const base64PaddingRegex = /=+$/

function sshString(value: string | Buffer) {
	const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
	const length = Buffer.alloc(4)
	length.writeUInt32BE(buffer.length)

	return Buffer.concat([length, buffer])
}

function makePublicKey(keyType = 'ssh-ed25519', comment = 'marta@laptop') {
	const blob = Buffer.concat([sshString(keyType), sshString(randomBytes(32))])

	return {
		blob,
		publicKey: `${keyType} ${blob.toString('base64')} ${comment}`,
	}
}

function makePublicKeyFromBlob(
	keyType: string,
	blob: Buffer,
	comment = 'marta@laptop'
) {
	return `${keyType} ${blob.toString('base64')} ${comment}`
}

function makeRsaPublicKey(exponent: Buffer, modulus: Buffer) {
	return makePublicKeyFromBlob(
		'ssh-rsa',
		Buffer.concat([
			sshString('ssh-rsa'),
			sshString(exponent),
			sshString(modulus),
		])
	)
}

function makePositiveRsaModulus(bitLength: number) {
	const byteLength = bitLength / 8

	return Buffer.concat([Buffer.from([0, 0x80]), randomBytes(byteLength - 1)])
}

describe(normalizeSshPublicKey.name, () => {
	test('normalizes OpenSSH public keys and computes SHA256 fingerprints', () => {
		const { blob, publicKey } = makePublicKey()

		expect(normalizeSshPublicKey(`  ${publicKey}  `)).toEqual({
			keyType: 'ssh-ed25519',
			publicKey,
			comment: 'marta@laptop',
			fingerprintSha256: `SHA256:${createHash('sha256')
				.update(blob)
				.digest('base64')
				.replace(base64PaddingRegex, '')}`,
		})
	})

	test('preserves comments with spaces', () => {
		const { publicKey } = makePublicKey('ssh-ed25519', 'Marta Laptop 2026')

		expect(normalizeSshPublicKey(publicKey)).toEqual(
			expect.objectContaining({
				comment: 'Marta Laptop 2026',
				publicKey,
			})
		)
	})

	test('rejects unsupported key types clearly', () => {
		const { publicKey } = makePublicKey('ssh-dss')

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects keys whose blob key type does not match the text prefix', () => {
		const { publicKey } = makePublicKey('ssh-ed25519')
		const mismatchedPublicKey = publicKey.replace(
			'ssh-ed25519',
			'ecdsa-sha2-nistp256'
		)

		expect(() => normalizeSshPublicKey(mismatchedPublicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects truncated key blobs', () => {
		const blob = Buffer.concat([sshString('ssh-ed25519'), Buffer.from([0, 0])])
		const publicKey = makePublicKeyFromBlob('ssh-ed25519', blob)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects structurally incomplete ECDSA key blobs', () => {
		const blob = Buffer.concat([
			sshString('ecdsa-sha2-nistp256'),
			sshString('nistp256'),
		])
		const publicKey = makePublicKeyFromBlob('ecdsa-sha2-nistp256', blob)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects ECDSA keys with the wrong curve', () => {
		const blob = Buffer.concat([
			sshString('ecdsa-sha2-nistp256'),
			sshString('nistp384'),
			sshString(Buffer.concat([Buffer.from([4]), randomBytes(64)])),
		])
		const publicKey = makePublicKeyFromBlob('ecdsa-sha2-nistp256', blob)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects short ECDSA public points', () => {
		const blob = Buffer.concat([
			sshString('ecdsa-sha2-nistp256'),
			sshString('nistp256'),
			sshString(Buffer.from([4])),
		])
		const publicKey = makePublicKeyFromBlob('ecdsa-sha2-nistp256', blob)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects zero RSA mpints', () => {
		const publicKey = makeRsaPublicKey(Buffer.from([1, 0, 1]), Buffer.from([0]))

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects negative RSA mpints', () => {
		const publicKey = makeRsaPublicKey(
			Buffer.from([1, 0, 1]),
			Buffer.from([0x80, ...randomBytes(127)])
		)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects tiny RSA exponents', () => {
		const publicKey = makeRsaPublicKey(
			Buffer.from([1]),
			Buffer.from([0x7f, ...randomBytes(127)])
		)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects tiny RSA moduli', () => {
		const publicKey = makeRsaPublicKey(
			Buffer.from([1, 0, 1]),
			Buffer.from([0x7f])
		)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('rejects RSA moduli smaller than 2048 bits', () => {
		const publicKey = makeRsaPublicKey(
			Buffer.from([1, 0, 1]),
			makePositiveRsaModulus(1024)
		)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})

	test('accepts RSA moduli with at least 2048 bits', () => {
		const publicKey = makeRsaPublicKey(
			Buffer.from([1, 0, 1]),
			makePositiveRsaModulus(2048)
		)

		expect(normalizeSshPublicKey(publicKey)).toEqual(
			expect.objectContaining({
				keyType: 'ssh-rsa',
				publicKey,
			})
		)
	})

	test('rejects key blobs with trailing data', () => {
		const blob = Buffer.concat([
			sshString('ssh-ed25519'),
			sshString(randomBytes(32)),
			Buffer.from([1]),
		])
		const publicKey = makePublicKeyFromBlob('ssh-ed25519', blob)

		expect(() => normalizeSshPublicKey(publicKey)).toThrow(
			InvalidSshPublicKeyError
		)
	})
})
