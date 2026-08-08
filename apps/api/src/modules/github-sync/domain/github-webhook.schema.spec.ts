import {
	isSupportedGitHubWebhookEvent,
	parseGitHubWebhookPayload,
} from './github-webhook.schema'

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

	test.each([
		['issue_comment', 'created'],
		['issue_comment', 'edited'],
		['issue_comment', 'deleted'],
		['pull_request_review', 'submitted'],
		['pull_request_review', 'edited'],
		['pull_request_review', 'dismissed'],
		['pull_request_review_comment', 'created'],
		['pull_request_review_comment', 'edited'],
		['pull_request_review_comment', 'deleted'],
		['pull_request_review_thread', 'resolved'],
		['pull_request_review_thread', 'unresolved'],
	])('allowlists %s.%s', (eventName, action) => {
		expect(isSupportedGitHubWebhookEvent({ eventName, action })).toBeTruthy()
	})

	test.each([
		['issues', 'opened'],
		['issue_comment', 'pinned'],
		['pull_request_review', 'created'],
		['pull_request_review_thread', 'created'],
	])('rejects non-allowlisted %s.%s', (eventName, action) => {
		expect(isSupportedGitHubWebhookEvent({ eventName, action })).toBeFalsy()
	})

	test('parses issue comment pull request identity', () => {
		expect(
			parseGitHubWebhookPayload(
				Buffer.from(
					JSON.stringify({
						action: 'created',
						issue: {
							number: 17,
							pull_request: { html_url: 'https://github.com/org/repo/pull/17' },
						},
						comment: { id: 3, node_id: 'issue-comment-node' },
					})
				)
			)
		).toMatchObject({ issue: { number: 17, pull_request: {} } })
	})

	test.each([
		'submitted',
		'edited',
		'dismissed',
	])('parses a %s review', action => {
		expect(
			parseGitHubWebhookPayload(
				Buffer.from(
					JSON.stringify({
						action,
						pull_request: { node_id: 'pr-node', number: 7 },
						review: {
							id: 4,
							node_id: 'review-node',
							state: 'approved',
							commit_id: 'head-sha',
							submitted_at: '2026-08-08T10:00:00Z',
						},
					})
				)
			).review
		).toMatchObject({ node_id: 'review-node', submitted_at: expect.any(Date) })
	})

	test('parses review comment reply and original coordinates', () => {
		expect(
			parseGitHubWebhookPayload(
				Buffer.from(
					JSON.stringify({
						action: 'created',
						comment: {
							id: 5,
							node_id: 'comment-node',
							pull_request_review_id: 4,
							in_reply_to_id: 3,
							subject_type: 'line',
							path: 'src/index.ts',
							side: 'RIGHT',
							line: 12,
							original_line: 9,
							start_side: 'LEFT',
							start_line: 8,
							original_start_line: 7,
							commit_id: 'head',
							original_commit_id: 'original-head',
						},
					})
				)
			).comment
		).toMatchObject({
			in_reply_to_id: 3,
			original_line: 9,
			original_start_line: 7,
		})
	})

	test.each(['resolved', 'unresolved'])('parses a %s review thread', action => {
		expect(
			parseGitHubWebhookPayload(
				Buffer.from(
					JSON.stringify({
						action,
						thread: {
							node_id: 'thread-node',
							comments: [{ id: 6, node_id: 'root-node' }],
						},
					})
				)
			).thread
		).toEqual({
			node_id: 'thread-node',
			comments: [{ id: 6, node_id: 'root-node' }],
		})
	})

	test('parses a requested team target', () => {
		expect(
			parseGitHubWebhookPayload(
				Buffer.from(
					JSON.stringify({
						action: 'review_requested',
						requested_team: {
							id: 8,
							node_id: 'team-node',
							slug: 'platform',
							name: 'Platform',
						},
					})
				)
			).requested_team
		).toMatchObject({ node_id: 'team-node', slug: 'platform' })
	})

	test.each([
		{ issue: { number: 0, pull_request: {} } },
		{ comment: { id: 1 } },
		{ review: { id: -1, node_id: '' } },
		{ requested_team: { id: 1, node_id: 'team', slug: '', name: 'Team' } },
	])('rejects malformed payload %#', malformed => {
		expect(() =>
			parseGitHubWebhookPayload(Buffer.from(JSON.stringify(malformed)))
		).toThrow()
	})
})
