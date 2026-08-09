import type {
	MergeBlockingReasonCode,
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { mergeQueueStates } from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import {
	pullRequestMergeStrategyEnum,
	pullRequests,
} from './pull-requests.schema'
import { repositories } from './repositories.schema'

export const mergeQueueEntryStateEnum = pgEnum(
	'merge_queue_entry_state',
	mergeQueueStates
)

/**
 * Why the worker parked an entry, as stored. The row keeps the whole reason the
 * evaluator produced — details and all — but only the code is typed here,
 * because the shape of the details belongs to the API contract: readers parse
 * the stored JSON back through it.
 */
export type MergeQueueBlockingReasonSnapshot = {
	code: MergeBlockingReasonCode
} & Record<string, unknown>

/**
 * One row per attempt to merge a pull request through the queue. Positions are
 * allocated monotonically under the repository queue-state row and never
 * renumbered; the position a user sees is how many runnable entries sit ahead
 * of this one, which is computed on read.
 */
export const mergeQueueEntries = pgTable(
	'merge_queue_entries',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<MergeQueueEntryId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		state: mergeQueueEntryStateEnum('state').default('queued').notNull(),
		enqueuedByUserId: uuid('enqueued_by_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		removedByUserId: uuid('removed_by_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		blockingReasons:
			jsonb('blocking_reasons').$type<MergeQueueBlockingReasonSnapshot[]>(),
		/**
		 * The method chosen when the entry was created. The queue decides when a
		 * pull request merges, not how, so this never changes while the entry
		 * waits — including across a pause and a retry.
		 */
		strategy: pullRequestMergeStrategyEnum('strategy')
			.default('merge_commit')
			.notNull(),
		/** The caller's overrides, kept only for the strategy that reads them. */
		squashTitle: text('squash_title'),
		squashBody: text('squash_body'),
		/** The refs the entry was evaluated against, not what it will merge. */
		enqueuedBaseSha: text('enqueued_base_sha'),
		enqueuedHeadSha: text('enqueued_head_sha'),
		enqueuedAt: timestamp('enqueued_at').defaultNow().notNull(),
		stateChangedAt: timestamp('state_changed_at').defaultNow().notNull(),
		validatingAt: timestamp('validating_at'),
		mergingAt: timestamp('merging_at'),
		pausedAt: timestamp('paused_at'),
		removedAt: timestamp('removed_at'),
		completedAt: timestamp('completed_at'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('merge_queue_entries_repository_position_unique').on(
			table.repositoryId,
			table.position
		),
		// A pull request may sit in the queue once. Terminal entries stay outside
		// the index so the same pull request can be enqueued again after it left.
		uniqueIndex('merge_queue_entries_active_pull_request_unique')
			.on(table.pullRequestId)
			.where(
				sql`${table.state} in ('queued', 'validating', 'merging', 'paused')`
			),
		index('merge_queue_entries_repository_state_position_idx').on(
			table.repositoryId,
			table.state,
			table.position
		),
		index('merge_queue_entries_pull_request_id_idx').on(table.pullRequestId),
		index('merge_queue_entries_enqueued_by_user_id_idx').on(
			table.enqueuedByUserId
		),
		index('merge_queue_entries_removed_by_user_id_idx').on(
			table.removedByUserId
		),
		check('merge_queue_entries_position_check', sql`${table.position} > 0`),
		check(
			'merge_queue_entries_terminal_state_check',
			sql`(
				(${table.state}::text in ('queued', 'validating', 'merging', 'paused') and ${table.removedAt} is null and ${table.removedByUserId} is null and ${table.completedAt} is null)
				or (${table.state}::text = 'removed' and ${table.removedAt} is not null and ${table.completedAt} is null)
				or (${table.state}::text = 'completed' and ${table.completedAt} is not null and ${table.removedAt} is null and ${table.removedByUserId} is null)
			)`
		),
		// Squash overrides belong to the one strategy that reads them; carrying
		// them on any other entry would leave text nothing will ever write.
		check(
			'merge_queue_entries_squash_options_check',
			sql`${table.strategy}::text = 'squash' or (${table.squashTitle} is null and ${table.squashBody} is null)`
		),
		check(
			'merge_queue_entries_active_state_check',
			sql`(
				(${table.state}::text <> 'validating' or ${table.validatingAt} is not null)
				and (${table.state}::text <> 'merging' or ${table.mergingAt} is not null)
				and (${table.state}::text <> 'paused' or (${table.pausedAt} is not null and ${table.blockingReasons} is not null))
			)`
		),
	]
)

/**
 * The per-repository merge lease and queue wakeup cursor. One row per
 * repository: the lease is what serializes the worker against a direct merge,
 * and the version pair is what tells a committed queue change from one whose
 * Redis wakeup was lost.
 */
export const repositoryMergeQueueStates = pgTable(
	'repository_merge_queue_states',
	{
		repositoryId: uuid('repository_id')
			.primaryKey()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		requestedVersion: integer('requested_version').default(0).notNull(),
		completedVersion: integer('completed_version').default(0).notNull(),
		/** Identifies the worker or request holding the lease, for recovery. */
		leaseOwner: text('lease_owner'),
		leaseAcquiredAt: timestamp('lease_acquired_at'),
		leaseExpiresAt: timestamp('lease_expires_at'),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		check(
			'repository_merge_queue_states_versions_check',
			sql`${table.requestedVersion} >= 0 and ${table.completedVersion} >= 0 and ${table.completedVersion} <= ${table.requestedVersion}`
		),
		check(
			'repository_merge_queue_states_lease_check',
			sql`(
				(${table.leaseOwner} is null and ${table.leaseAcquiredAt} is null and ${table.leaseExpiresAt} is null)
				or (${table.leaseOwner} is not null and ${table.leaseAcquiredAt} is not null and ${table.leaseExpiresAt} is not null and ${table.leaseExpiresAt} > ${table.leaseAcquiredAt})
			)`
		),
	]
)

export type MergeQueueEntry = typeof mergeQueueEntries.$inferSelect
export type NewMergeQueueEntry = typeof mergeQueueEntries.$inferInsert
export type RepositoryMergeQueueState =
	typeof repositoryMergeQueueStates.$inferSelect
export type NewRepositoryMergeQueueState =
	typeof repositoryMergeQueueStates.$inferInsert

export const mergeQueueEntryRelations = relations(
	mergeQueueEntries,
	({ one }) => ({
		repository: one(repositories, {
			fields: [mergeQueueEntries.repositoryId],
			references: [repositories.id],
		}),
		pullRequest: one(pullRequests, {
			fields: [mergeQueueEntries.pullRequestId],
			references: [pullRequests.id],
		}),
		enqueuedByUser: one(user, {
			fields: [mergeQueueEntries.enqueuedByUserId],
			references: [user.id],
			relationName: 'merge_queue_entry_enqueuer',
		}),
		removedByUser: one(user, {
			fields: [mergeQueueEntries.removedByUserId],
			references: [user.id],
			relationName: 'merge_queue_entry_remover',
		}),
	})
)

export const repositoryMergeQueueStateRelations = relations(
	repositoryMergeQueueStates,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryMergeQueueStates.repositoryId],
			references: [repositories.id],
		}),
	})
)
