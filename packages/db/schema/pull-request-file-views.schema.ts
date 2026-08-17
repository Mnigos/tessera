import type { PullRequestId, UserId } from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { pullRequests } from './pull-requests.schema'

// The row's presence is the state; nothing records a file the viewer has not ticked.
export const pullRequestFileViews = pgTable(
	'pull_request_file_views',
	{
		userId: uuid('user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		headSha: text('head_sha').notNull(),
		viewedAt: timestamp('viewed_at').defaultNow().notNull(),
	},
	table => [
		primaryKey({
			name: 'pull_request_file_views_pkey',
			columns: [table.userId, table.pullRequestId, table.path, table.headSha],
		}),
		index('pull_request_file_views_pull_request_user_head_idx').on(
			table.pullRequestId,
			table.userId,
			table.headSha
		),
	]
)

export const pullRequestFileViewRelations = relations(
	pullRequestFileViews,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestFileViews.pullRequestId],
			references: [pullRequests.id],
		}),
		user: one(user, {
			fields: [pullRequestFileViews.userId],
			references: [user.id],
		}),
	})
)
