import { createHash } from 'node:crypto'
import { InvalidSshPublicKeyError } from './ssh-public-key.errors'

const supportedKeyTypes = new Set([
	'ssh-ed25519',
	'sk-ssh-ed25519@openssh.com',
	'ecdsa-sha2-nistp256',
	'ecdsa-sha2-nistp384',
	'ecdsa-sha2-nistp521',
	'sk-ecdsa-sha2-nistp256@openssh.com',
	'rsa-sha2-256',
	'rsa-sha2-512',
	'ssh-rsa',
])
const whitespaceRegex = /\s+/
const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/
const base64PaddingRegex = /=+$/
const ecdsaCurvesByKeyType = {
	'ecdsa-sha2-nistp256': 'nistp256',
	'ecdsa-sha2-nistp384': 'nistp384',
	'ecdsa-sha2-nistp521': 'nistp521',
	'sk-ecdsa-sha2-nistp256@openssh.com': 'nistp256',
} as const
const ecdsaPointLengthsByCurve = {
	nistp256: 65,
	nistp384: 97,
	nistp521: 133,
} as const
const ed25519KeyLength = 32
const minimumRsaExponent = 3n
const minimumRsaModulusBits = 2048

export interface NormalizedSshPublicKey {
	keyType: string
	publicKey: string
	fingerprintSha256: string
	comment: string | undefined
}

export function normalizeSshPublicKey(input: string): NormalizedSshPublicKey {
	const trimmedInput = input.trim()
	const [keyType, keyBlobBase64, ...commentParts] =
		trimmedInput.split(whitespaceRegex)

	if (!(keyType && keyBlobBase64))
		throw new InvalidSshPublicKeyError({ reason: 'missing_key_parts' })

	if (!supportedKeyTypes.has(keyType))
		throw new InvalidSshPublicKeyError({
			keyType,
			reason: 'unsupported_key_type',
		})

	const keyBlob = decodeBase64KeyBlob(keyBlobBase64)
	const blobKeyType = readSshString(keyBlob, 0)?.value.toString('utf8')

	if (!isMatchingBlobKeyType(keyType, blobKeyType))
		throw new InvalidSshPublicKeyError({
			keyType,
			blobKeyType,
			reason: 'key_type_mismatch',
		})

	validateKeyBlob(keyType, keyBlob)

	const normalizedBlob = keyBlob.toString('base64')
	const comment = commentParts.join(' ') || undefined
	const publicKey = [keyType, normalizedBlob, comment].filter(Boolean).join(' ')
	const fingerprintSha256 = `SHA256:${createHash('sha256')
		.update(keyBlob)
		.digest('base64')
		.replace(base64PaddingRegex, '')}`

	return {
		keyType,
		publicKey,
		fingerprintSha256,
		comment,
	}
}

function isMatchingBlobKeyType(
	keyType: string,
	blobKeyType: string | undefined
) {
	if (keyType.startsWith('rsa-sha2-')) return blobKeyType === 'ssh-rsa'

	return blobKeyType === keyType
}

function validateKeyBlob(keyType: string, keyBlob: Buffer): void {
	if (keyType === 'ssh-ed25519') {
		const offset = readAndValidateKeyType(keyBlob)
		const publicKey = readRequiredSshString(keyBlob, offset, 'public_key')

		if (publicKey.value.length !== ed25519KeyLength)
			throw new InvalidSshPublicKeyError({
				keyType,
				reason: 'invalid_ed25519_key_length',
			})

		assertFullyConsumed(keyBlob, publicKey.nextOffset, keyType)
		return
	}

	if (keyType === 'sk-ssh-ed25519@openssh.com') {
		const offset = readAndValidateKeyType(keyBlob)
		const publicKey = readRequiredSshString(keyBlob, offset, 'public_key')

		if (publicKey.value.length !== ed25519KeyLength)
			throw new InvalidSshPublicKeyError({
				keyType,
				reason: 'invalid_ed25519_key_length',
			})

		const application = readRequiredSshString(
			keyBlob,
			publicKey.nextOffset,
			'application'
		)
		assertFullyConsumed(keyBlob, application.nextOffset, keyType)
		return
	}

	if (keyType in ecdsaCurvesByKeyType) {
		const expectedCurve =
			ecdsaCurvesByKeyType[keyType as keyof typeof ecdsaCurvesByKeyType]
		const offset = readAndValidateKeyType(keyBlob)
		const curveField = readRequiredSshString(keyBlob, offset, 'curve')
		const curve = curveField.value.toString('utf8')

		if (curve !== expectedCurve)
			throw new InvalidSshPublicKeyError({
				keyType,
				curve,
				expectedCurve,
				reason: 'wrong_ecdsa_curve',
			})

		const publicKey = readRequiredSshString(
			keyBlob,
			curveField.nextOffset,
			'public_key'
		)

		if (
			publicKey.value.length !== ecdsaPointLengthsByCurve[expectedCurve] ||
			publicKey.value[0] !== 4
		)
			throw new InvalidSshPublicKeyError({
				keyType,
				reason: 'invalid_ecdsa_public_key',
			})

		if (keyType === 'sk-ecdsa-sha2-nistp256@openssh.com') {
			const application = readRequiredSshString(
				keyBlob,
				publicKey.nextOffset,
				'application'
			)
			assertFullyConsumed(keyBlob, application.nextOffset, keyType)
			return
		}

		assertFullyConsumed(keyBlob, publicKey.nextOffset, keyType)
		return
	}

	if (
		keyType === 'ssh-rsa' ||
		keyType === 'rsa-sha2-256' ||
		keyType === 'rsa-sha2-512'
	) {
		const offset = readAndValidateKeyType(keyBlob)
		const exponent = readRequiredSshString(keyBlob, offset, 'exponent')
		const modulus = readRequiredSshString(
			keyBlob,
			exponent.nextOffset,
			'modulus'
		)

		validateRsaMpint(exponent.value, keyType, 'exponent')
		validateRsaMpint(modulus.value, keyType, 'modulus')

		if (toPositiveBigInt(exponent.value) < minimumRsaExponent)
			throw new InvalidSshPublicKeyError({
				keyType,
				field: 'exponent',
				reason: 'rsa_exponent_too_small',
			})

		if (rsaModulusBitLength(modulus.value) < minimumRsaModulusBits)
			throw new InvalidSshPublicKeyError({
				keyType,
				field: 'modulus',
				reason: 'rsa_modulus_too_small',
			})

		assertFullyConsumed(keyBlob, modulus.nextOffset, keyType)
		return
	}

	throw new InvalidSshPublicKeyError({
		keyType,
		reason: 'unsupported_key_type',
	})
}

function validateRsaMpint(value: Buffer, keyType: string, field: string) {
	if (value.length === 0)
		throw new InvalidSshPublicKeyError({
			keyType,
			field,
			reason: 'empty_rsa_mpint',
		})

	if (value.every(byte => byte === 0))
		throw new InvalidSshPublicKeyError({
			keyType,
			field,
			reason: 'zero_rsa_mpint',
		})

	const firstByte = value.at(0)

	if (firstByte === undefined)
		throw new InvalidSshPublicKeyError({
			keyType,
			field,
			reason: 'empty_rsa_mpint',
		})

	if (firstByte >= 0x80)
		throw new InvalidSshPublicKeyError({
			keyType,
			field,
			reason: 'negative_rsa_mpint',
		})
}

function toPositiveBigInt(value: Buffer) {
	let result = 0n

	for (const byte of value) result = result * 256n + BigInt(byte)

	return result
}

function rsaModulusBitLength(value: Buffer) {
	const firstNonZeroIndex = value.findIndex(byte => byte !== 0)
	if (firstNonZeroIndex === -1) return 0

	const firstNonZeroByte = value.at(firstNonZeroIndex)
	if (firstNonZeroByte === undefined) return 0

	const remainingBytes = value.length - firstNonZeroIndex - 1

	return remainingBytes * 8 + firstNonZeroByte.toString(2).length
}

function readAndValidateKeyType(keyBlob: Buffer) {
	const keyType = readRequiredSshString(keyBlob, 0, 'key_type')

	return keyType.nextOffset
}

function readRequiredSshString(
	buffer: Buffer,
	offset: number,
	field: string
): SshStringReadResult {
	const value = readSshString(buffer, offset)

	if (!value)
		throw new InvalidSshPublicKeyError({
			field,
			reason: 'malformed_key_blob',
		})

	return value
}

function assertFullyConsumed(buffer: Buffer, offset: number, keyType: string) {
	if (offset !== buffer.length)
		throw new InvalidSshPublicKeyError({
			keyType,
			reason: 'trailing_key_blob_data',
		})
}

function decodeBase64KeyBlob(keyBlobBase64: string): Buffer {
	if (!base64Regex.test(keyBlobBase64))
		throw new InvalidSshPublicKeyError({ reason: 'invalid_base64' })

	const keyBlob = Buffer.from(keyBlobBase64, 'base64')

	if (keyBlob.length === 0 || keyBlob.toString('base64') !== keyBlobBase64)
		throw new InvalidSshPublicKeyError({ reason: 'invalid_key_blob' })

	return keyBlob
}

interface SshStringReadResult {
	value: Buffer
	nextOffset: number
}

function readSshString(
	buffer: Buffer,
	offset: number
): SshStringReadResult | undefined {
	if (offset + 4 > buffer.length) return undefined

	const length = buffer.readUInt32BE(offset)
	const start = offset + 4
	const end = start + length

	if (length === 0 || end > buffer.length) return undefined

	return {
		value: buffer.subarray(start, end),
		nextOffset: end,
	}
}
