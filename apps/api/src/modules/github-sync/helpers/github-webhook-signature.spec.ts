import { createHmac } from 'node:crypto'
import { verifyGitHubWebhookSignature } from './github-webhook-signature'

describe('verifyGitHubWebhookSignature', () => {
	const rawBody = Buffer.from('{"action":"opened"}')
	const secret = 'webhook-secret'

	test('accepts a matching sha256 signature', () => {
		const digest = createHmac('sha256', secret).update(rawBody).digest('hex')

		expect(
			verifyGitHubWebhookSignature({
				rawBody,
				secret,
				signature: `sha256=${digest}`,
			})
		).toBe(true)
	})

	test.each([
		'not-sha256',
		'sha256=short',
		`sha256=${'z'.repeat(64)}`,
		`sha256=${'0'.repeat(64)}`,
	])('rejects invalid signature %s', signature => {
		expect(verifyGitHubWebhookSignature({ rawBody, secret, signature })).toBe(
			false
		)
	})
})
