import type {
	Brand,
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { isNotNull, isNull, relations, sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
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
import { pullRequestEvents, pullRequests } from './pull-requests.schema'
import { repositories } from './repositories.schema'
import {
	type GitHubInstallationId,
	gitHubInstallations,
	gitHubSyncAttemptTriggerEnum,
} from './repository-external-sources.schema'

export type GitHubActorId = Brand<string, 'github_actor_id'>
export type GitHubPullRequestMappingId = Brand<
	string,
	'github_pull_request_mapping_id'
>
export type GitHubPullRequestEventMappingId = Brand<
	string,
	'github_pull_request_event_mapping_id'
>
export type GitHubWebhookDeliveryId = Brand<
	string,
	'github_webhook_delivery_id'
>
export type GitHubSyncAttemptId = Brand<string, 'github_sync_attempt_id'>

/**
 * Labels and assignees are GitHub's own display data: it owns their lifecycle,
 * Tessera never edits them, and nothing joins on them. They travel as snapshots
 * rather than tables so a rename on GitHub is one overwrite, not a migration.
 */
export interface GitHubPullRequestLabel {
	name: string
	/** GitHub's six-digit hex colour, stored without the leading `#`. */
	color: string
	description?: string
}

export interface GitHubPullRequestAssignee {
	login: string
	avatarUrl?: string
	htmlUrl?: string
}

/**
 * How one attempt ended. `partial` is a run that finalized without reconciling
 * everything it set out to, which the source's own status cannot express: it is
 * recorded as `succeeded` there and only the attempt row remembers otherwise.
 *
 * `interrupted` is a run that reached no outcome at all — its authority moved on
 * mid-run, or the worker died and a later claim found the row still open. It is
 * deliberately not a failure: counting it as one would blame a repository for a
 * deploy, and counting it as a completed operation would dilute the failure rate
 * with runs that never finished deciding anything.
 */
export const gitHubSyncAttemptStatuses = [
	'running',
	'succeeded',
	'partial',
	'retry_scheduled',
	'terminal_failed',
	'blocked',
	'interrupted',
] as const
export type GitHubSyncAttemptStatus = (typeof gitHubSyncAttemptStatuses)[number]

/** The failure taxonomy retries, defers, blocks, and terminalizes are chosen from. */
export const gitHubSyncFailureClasses = [
	'transport',
	'rate_limit',
	'authentication',
	'validation',
	'permanent_not_found',
	'unknown',
] as const
export type GitHubSyncFailureClass = (typeof gitHubSyncFailureClasses)[number]

export const gitHubActorTypeEnum = pgEnum('github_actor_type', [
	'user',
	'bot',
	'organization',
	'mannequin',
])

export const gitHubSyncAttemptStatusEnum = pgEnum(
	'github_sync_attempt_status',
	gitHubSyncAttemptStatuses
)

export const gitHubSyncFailureClassEnum = pgEnum(
	'github_sync_failure_class',
	gitHubSyncFailureClasses
)

export const gitHubWebhookDeliveryStatusEnum = pgEnum(
	'github_webhook_delivery_status',
	['received', 'processed', 'failed', 'ignored']
)

export const gitHubWebhookTargetResourceKindEnum = pgEnum(
	'github_webhook_target_resource_kind',
	[
		'pull_request',
		'issue_comment',
		'review_comment',
		'review',
		'review_thread',
		'check_suite',
		'check_run',
		'commit_status',
	]
)

export const gitHubActors = pgTable(
	'github_actors',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<GitHubActorId>(),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' }),
		login: text('login').notNull(),
		type: gitHubActorTypeEnum('type').notNull(),
		avatarUrl: text('avatar_url'),
		htmlUrl: text('html_url'),
		userId: uuid('user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		uniqueIndex('github_actors_external_numeric_id_unique')
			.on(table.externalNumericId)
			.where(isNotNull(table.externalNumericId)),
		index('github_actors_user_id_idx').on(table.userId),
	]
)

export const gitHubWebhookDeliveries = pgTable(
	'github_webhook_deliveries',
	{
		id: uuid('id').primaryKey().$type<GitHubWebhookDeliveryId>(),
		repositoryId: uuid('repository_id')
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		installationId: uuid('installation_id')
			.$type<GitHubInstallationId>()
			.references(() => gitHubInstallations.id, { onDelete: 'set null' }),
		eventName: text('event_name').notNull(),
		action: text('action'),
		externalRepositoryNodeId: text('external_repository_node_id'),
		externalRepositoryNumericId: bigint('external_repository_numeric_id', {
			mode: 'bigint',
		}),
		subjectNodeId: text('subject_node_id'),
		subjectNumber: integer('subject_number'),
		issueNumber: integer('issue_number'),
		targetResourceKind: gitHubWebhookTargetResourceKindEnum(
			'target_resource_kind'
		),
		targetResourceNodeId: text('target_resource_node_id'),
		targetResourceNumericId: bigint('target_resource_numeric_id', {
			mode: 'bigint',
		}),
		targetTeamNodeId: text('target_team_node_id'),
		targetTeamSlug: text('target_team_slug'),
		/**
		 * Checks are reported against a commit, not a pull request, so a check
		 * delivery targets the SHA it names — which may belong to no pull request
		 * Tessera tracks, or to one whose head has already moved past it.
		 */
		targetSha: text('target_sha'),
		/** The status context or check-run name, when the event carries one. */
		targetContext: text('target_context'),
		senderActorId: uuid('sender_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'set null' }),
		targetActorId: uuid('target_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'set null' }),
		labelNodeId: text('label_node_id'),
		labelName: text('label_name'),
		syncVersion: bigint('sync_version', { mode: 'number' }),
		status: gitHubWebhookDeliveryStatusEnum('status')
			.default('received')
			.notNull(),
		receivedAt: timestamp('received_at').defaultNow().notNull(),
		processedAt: timestamp('processed_at'),
		failedAt: timestamp('failed_at'),
		/** A code from Tessera's own taxonomy, never a provider string. */
		failureCode: text('failure_code'),
		failureReason: text('failure_reason'),
	},
	table => [
		index('github_webhook_deliveries_repository_received_at_idx').on(
			table.repositoryId,
			table.receivedAt
		),
		index('github_webhook_deliveries_installation_id_idx').on(
			table.installationId
		),
		// Both the pending-delivery health counters and the per-run pending sweeps
		// read only the deliveries still waiting, which is the small tail of a
		// table that otherwise grows forever.
		index('github_webhook_deliveries_pending_idx')
			.on(table.repositoryId, table.receivedAt)
			.where(sql`${table.status} = 'received'`),
		index('github_webhook_deliveries_target_actor_id_idx').on(
			table.targetActorId
		),
	]
)

/**
 * One row per reconciliation the worker actually started, which is what the
 * source row cannot keep: it holds the current state, while operators and the
 * sync-health read model need the history behind it — how often work was
 * retried, how long a run took, and whether a run that finalized had in fact
 * reconciled everything.
 *
 * Redis is not that history. Failed jobs are pruned and a job that exhausts its
 * attempts disappears, so these rows are the durable record and BullMQ's
 * retention is only a debugging convenience.
 */
export const gitHubSyncAttempts = pgTable(
	'github_sync_attempts',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<GitHubSyncAttemptId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		installationId: uuid('installation_id')
			.$type<GitHubInstallationId>()
			.references(() => gitHubInstallations.id, { onDelete: 'set null' }),
		authorityGeneration: integer('authority_generation').notNull(),
		requestedSyncVersion: bigint('requested_sync_version', {
			mode: 'number',
		}).notNull(),
		trigger: gitHubSyncAttemptTriggerEnum('trigger').notNull(),
		/**
		 * Which try at this exact version this row is. The source's failure counter
		 * counts the same thing today, but it resets on success and cannot separate
		 * one operation that was retried from several that each failed once.
		 */
		attemptNumber: integer('attempt_number').notNull(),
		jobId: text('job_id'),
		status: gitHubSyncAttemptStatusEnum('status').notNull(),
		failureClass: gitHubSyncFailureClassEnum('failure_class'),
		failureCode: text('failure_code'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at'),
		durationMs: integer('duration_ms'),
		/** When the work is due again, for the outcomes that leave it due. */
		retryAt: timestamp('retry_at'),
		replayDeliveryId: uuid('replay_delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		// One repository lease means one attempt at a time, so the try counter is
		// unique by construction and the constraint keeps a double write out.
		unique('github_sync_attempts_operation_attempt_unique').on(
			table.repositoryId,
			table.authorityGeneration,
			table.requestedSyncVersion,
			table.attemptNumber
		),
		// Health reads every window from the newest attempts backwards.
		index('github_sync_attempts_repository_started_at_idx').on(
			table.repositoryId,
			table.startedAt.desc()
		),
		// The latest-outcome read orders by finish time over the attempts that
		// reached one, so it gets the order it asks for and skips the open rows
		// instead of sorting them and discarding them.
		index('github_sync_attempts_repository_finished_at_idx')
			.on(table.repositoryId, table.finishedAt.desc())
			.where(isNotNull(table.finishedAt)),
		index('github_sync_attempts_installation_id_idx').on(table.installationId),
		index('github_sync_attempts_replay_delivery_id_idx').on(
			table.replayDeliveryId
		),
		check(
			'github_sync_attempts_attempt_number_check',
			sql`${table.attemptNumber} > 0`
		),
		check(
			'github_sync_attempts_duration_check',
			sql`${table.durationMs} is null or ${table.durationMs} >= 0`
		),
		// A run either is still going or has ended; nothing reads a finish time
		// from a row that never finished, and no ended row may omit one.
		check(
			'github_sync_attempts_finished_check',
			sql`(${table.status}::text = 'running' and ${table.finishedAt} is null) or (${table.status}::text <> 'running' and ${table.finishedAt} is not null)`
		),
	]
)

export const gitHubPullRequestMappings = pgTable(
	'github_pull_request_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestMappingId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' })
			.unique(),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', {
			mode: 'bigint',
		}).notNull(),
		externalNumber: integer('external_number').notNull(),
		htmlUrl: text('html_url').notNull(),
		authorActorId: uuid('author_actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		mergedByActorId: uuid('merged_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		headRepositoryNodeId: text('head_repository_node_id'),
		baseRepositoryNodeId: text('base_repository_node_id').notNull(),
		headSha: text('head_sha').notNull(),
		baseSha: text('base_sha').notNull(),
		draft: boolean('draft').default(false).notNull(),
		labels: jsonb('labels').$type<GitHubPullRequestLabel[]>(),
		assignees: jsonb('assignees').$type<GitHubPullRequestAssignee[]>(),
		/** GitHub's mergeability verdict as of the last sync; null before the first stats read. */
		providerMergeableState: text('provider_mergeable_state').$type<
			'mergeable' | 'conflicting' | 'unknown'
		>(),
		/** Whether GitHub can replay the branch for a rebase merge; null before the first stats read. */
		providerCanBeRebased: boolean('provider_can_be_rebased'),
		providerCreatedAt: timestamp('provider_created_at').notNull(),
		providerUpdatedAt: timestamp('provider_updated_at').notNull(),
		providerClosedAt: timestamp('provider_closed_at'),
		providerMergedAt: timestamp('provider_merged_at'),
		lastSyncedAt: timestamp('last_synced_at').notNull(),
		/** Rotation cursor for the bounded conversation repair sweep. */
		conversationSyncedAt: timestamp('conversation_synced_at'),
		/**
		 * Rotation cursor for the bounded checks repair sweep. Checks are scoped to
		 * a commit rather than a pull request, so this records when the head this
		 * mapping currently points at was last reconciled.
		 */
		checksSyncedAt: timestamp('checks_synced_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('github_pull_request_mappings_repository_number_unique').on(
			table.repositoryId,
			table.externalNumber
		),
		unique('github_pull_request_mappings_repository_numeric_id_unique').on(
			table.repositoryId,
			table.externalNumericId
		),
		index('github_pull_request_mappings_author_actor_id_idx').on(
			table.authorActorId
		),
		// The rotation reads the least recently projected mappings first and treats
		// a mapping never projected as the oldest, so the index carries that exact
		// order — including the number it breaks ties on — and the scan needs no sort.
		index('github_pull_request_mappings_conversation_synced_at_idx').on(
			table.repositoryId,
			table.conversationSyncedAt.asc().nullsFirst(),
			table.externalNumber.asc()
		),
		// The checks sweep rotates over open pull requests only, so the index is
		// partial on exactly that set and carries the order the sweep reads in.
		index('github_pull_request_mappings_checks_synced_at_idx')
			.on(
				table.repositoryId,
				table.checksSyncedAt.asc().nullsFirst(),
				table.externalNumber.asc()
			)
			.where(isNull(table.providerClosedAt)),
	]
)

export const gitHubPullRequestEventMappings = pgTable(
	'github_pull_request_event_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestEventMappingId>(),
		pullRequestEventId: uuid('pull_request_event_id')
			.notNull()
			.$type<PullRequestEventId>()
			.references(() => pullRequestEvents.id, { onDelete: 'cascade' })
			.unique(),
		externalKey: text('external_key').notNull().unique(),
		actorId: uuid('actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('github_pull_request_event_mappings_actor_id_idx').on(table.actorId),
	]
)

export type GitHubActor = typeof gitHubActors.$inferSelect
export type NewGitHubActor = typeof gitHubActors.$inferInsert
export type GitHubWebhookDelivery = typeof gitHubWebhookDeliveries.$inferSelect
export type NewGitHubWebhookDelivery =
	typeof gitHubWebhookDeliveries.$inferInsert
export type GitHubPullRequestMapping =
	typeof gitHubPullRequestMappings.$inferSelect
export type NewGitHubPullRequestMapping =
	typeof gitHubPullRequestMappings.$inferInsert
export type GitHubSyncAttempt = typeof gitHubSyncAttempts.$inferSelect
export type NewGitHubSyncAttempt = typeof gitHubSyncAttempts.$inferInsert

export const gitHubActorRelations = relations(
	gitHubActors,
	({ many, one }) => ({
		user: one(user, {
			fields: [gitHubActors.userId],
			references: [user.id],
		}),
		authoredPullRequests: many(gitHubPullRequestMappings, {
			relationName: 'github_pull_request_author',
		}),
		mergedPullRequests: many(gitHubPullRequestMappings, {
			relationName: 'github_pull_request_merger',
		}),
	})
)

export const gitHubPullRequestMappingRelations = relations(
	gitHubPullRequestMappings,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubPullRequestMappings.repositoryId],
			references: [repositories.id],
		}),
		pullRequest: one(pullRequests, {
			fields: [gitHubPullRequestMappings.pullRequestId],
			references: [pullRequests.id],
		}),
		authorActor: one(gitHubActors, {
			fields: [gitHubPullRequestMappings.authorActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_author',
		}),
		mergedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestMappings.mergedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_merger',
		}),
	})
)

export const gitHubSyncAttemptRelations = relations(
	gitHubSyncAttempts,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubSyncAttempts.repositoryId],
			references: [repositories.id],
		}),
		installation: one(gitHubInstallations, {
			fields: [gitHubSyncAttempts.installationId],
			references: [gitHubInstallations.id],
		}),
		replayDelivery: one(gitHubWebhookDeliveries, {
			fields: [gitHubSyncAttempts.replayDeliveryId],
			references: [gitHubWebhookDeliveries.id],
		}),
	})
)

export const gitHubWebhookDeliveryRelations = relations(
	gitHubWebhookDeliveries,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubWebhookDeliveries.repositoryId],
			references: [repositories.id],
		}),
		installation: one(gitHubInstallations, {
			fields: [gitHubWebhookDeliveries.installationId],
			references: [gitHubInstallations.id],
		}),
		senderActor: one(gitHubActors, {
			fields: [gitHubWebhookDeliveries.senderActorId],
			references: [gitHubActors.id],
			relationName: 'github_webhook_delivery_sender',
		}),
		targetActor: one(gitHubActors, {
			fields: [gitHubWebhookDeliveries.targetActorId],
			references: [gitHubActors.id],
			relationName: 'github_webhook_delivery_target',
		}),
	})
)
