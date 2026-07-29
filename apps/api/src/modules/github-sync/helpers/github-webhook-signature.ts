import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='
const SHA256_HEX_LENGTH = 64
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i

export function verifyGitHubWebhookSignature({
	rawBody,
	secret,
	signature,
}: {
	rawBody: Buffer
	secret: string
	signature: string
}): boolean {
	if (!signature.startsWith(SIGNATURE_PREFIX)) return false

	const receivedDigest = signature.slice(SIGNATURE_PREFIX.length)
	if (
		receivedDigest.length !== SHA256_HEX_LENGTH ||
		!SHA256_HEX_REGEX.test(receivedDigest)
	)
		return false

	const expectedDigest = createHmac('sha256', secret)
		.update(rawBody)
		.digest('hex')

	return timingSafeEqual(
		Buffer.from(expectedDigest, 'hex'),
		Buffer.from(receivedDigest, 'hex')
	)
}
