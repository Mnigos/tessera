import { parseGitHubWebhookPayload } from './github-webhook.schema'

describe('parseGitHubWebhookPayload', () => {
	test('accepts a pull request payload with an abbreviated installation', () => {
		const payload = parseGitHubWebhookPayload(
			Buffer.from(
				JSON.stringify({
					action: 'opened',
					installation: { id: 123, node_id: 'installation-node' },
					repository: { id: 456, node_id: 'repository-node' },
					pull_request: { node_id: 'pull-request-node', number: 7 },
					sender: {
						id: 9,
						node_id: 'sender-node',
						login: 'marta',
						type: 'User',
					},
				})
			)
		)

		expect(payload).toEqual({
			action: 'opened',
			installation: { id: 123 },
			repository: { id: 456, node_id: 'repository-node' },
			pull_request: { node_id: 'pull-request-node', number: 7 },
			sender: {
				id: 9,
				node_id: 'sender-node',
				login: 'marta',
				type: 'User',
			},
		})
	})

	test('coerces an installation suspension timestamp', () => {
		const payload = parseGitHubWebhookPayload(
			Buffer.from(
				JSON.stringify({
					action: 'suspend',
					installation: {
						id: 123,
						suspended_at: '2026-08-05T10:00:00Z',
					},
				})
			)
		)

		expect(payload.installation?.suspended_at).toEqual(
			new Date('2026-08-05T10:00:00Z')
		)
	})
})
