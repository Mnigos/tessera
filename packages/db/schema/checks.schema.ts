import type { CheckId, CheckObservationId, RepositoryId } from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	bigint,
	bigserial,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import {
	type GitHubWebhookDeliveryId,
	gitHubWebhookDeliveries,
} from './github-sync.schema'
import { repositories } from './repositories.schema'

/**
 * A commit status and a check run sharing a name are different checks — GitHub
 * treats them as separately requirable — so the kind is part of the identity of
 * a context rather than a provider detail.
 */
export const checkKindEnum = pgEnum('check_kind', ['status', 'check_run'])

/**
 * The canonical result vocabulary every provider normalizes into. `stale` is
 * GitHub's terminal conclusion for a result it invalidated itself; a result
 * merely computed against a head the pull request has moved past is not stale
 * here, it is reported through `headIsCurrent` on the read side.
 */
export const checkStateEnum = pgEnum('check_state', [
	'queued',
	'pending',
	'success',
	'failure',
	'neutral',
	'canceled',
	'skipped',
	'timed_out',
	'stale',
])

/**
 * The nameplate of a test on one commit. A check run keeps one row per provider
 * run identity, so a rerun under a new run ID competes with the old one for the
 * context; every commit status posted against a context shares a single row.
 */
export const checks = pgTable(
	'checks',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<CheckId>(),
		// Deleting the repository is the one sanctioned way this data goes away;
		// nothing else in Tessera deletes a check, and the logbook below refuses to
		// let anything try.
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		sha: text('sha').notNull(),
		kind: checkKindEnum('kind').notNull(),
		context: text('context').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('checks_repository_sha_context_kind_idx').on(
			table.repositoryId,
			table.sha,
			table.context,
			table.kind
		),
		// Commit statuses have no run identity: every submission against a context
		// is another page in one stream, so the stream itself has to be unique.
		// Check runs deliberately stay outside this — same name, new run ID is a
		// new logical check.
		uniqueIndex('checks_status_stream_unique')
			.on(table.repositoryId, table.sha, table.context)
			.where(sql`${table.kind} = 'status'`),
	]
)

/**
 * The immutable logbook of a check. Providers rerun, resubmit and re-report; a
 * projection only ever appends here, and the effective result is the newest
 * page rather than a mutable column.
 *
 * Nothing may rewrite or truncate it. The logbook belongs to the repository
 * directly so that dropping a repository still takes its checks with it, while
 * every intra-repository reference is `no action`: deleting a check out from
 * under its pages, or a delivery out from under the provenance that names it,
 * raises rather than silently rewriting the record.
 */
export const checkObservations = pgTable(
	'check_observations',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<CheckObservationId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		checkId: uuid('check_id')
			.notNull()
			.$type<CheckId>()
			.references(() => checks.id, { onDelete: 'no action' }),
		/**
		 * The order the ledger itself appended in. Row IDs are random and provider
		 * timestamps are missing on requeued runs, so this is the only monotonic
		 * tiebreak the effective-result query can trust.
		 */
		sequence: bigserial('sequence', { mode: 'bigint' }).notNull(),
		state: checkStateEnum('state').notNull(),
		/** Preserved verbatim: GitHub's `error` and `action_required` normalize away. */
		rawStatus: text('raw_status'),
		rawConclusion: text('raw_conclusion'),
		targetUrl: text('target_url'),
		description: text('description'),
		outputTitle: text('output_title'),
		outputSummary: text('output_summary'),
		/** Set by native writers once TES-55 issues check-writing credentials. */
		credentialId: uuid('credential_id'),
		providerCreatedAt: timestamp('provider_created_at'),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		observedAt: timestamp('observed_at').defaultNow().notNull(),
		syncVersion: bigint('sync_version', { mode: 'number' }),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'no action' }),
		/** Content identity of one provider report; makes a replayed snapshot a no-op. */
		fingerprint: text('fingerprint').notNull(),
	},
	table => [
		unique('check_observations_check_fingerprint_unique').on(
			table.checkId,
			table.fingerprint
		),
		// The effective-result query reads the newest page of a check first, in the
		// ledger's own append order, so the index carries that exact order — down to
		// the tiebreak — and the scan needs no sort.
		index('check_observations_check_id_recency_idx').on(
			table.checkId,
			table.observedAt.desc(),
			table.sequence.desc()
		),
	]
)

export type Check = typeof checks.$inferSelect
export type NewCheck = typeof checks.$inferInsert
export type CheckObservation = typeof checkObservations.$inferSelect
export type NewCheckObservation = typeof checkObservations.$inferInsert

export const checkRelations = relations(checks, ({ many, one }) => ({
	repository: one(repositories, {
		fields: [checks.repositoryId],
		references: [repositories.id],
	}),
	observations: many(checkObservations),
}))

export const checkObservationRelations = relations(
	checkObservations,
	({ one }) => ({
		repository: one(repositories, {
			fields: [checkObservations.repositoryId],
			references: [repositories.id],
		}),
		check: one(checks, {
			fields: [checkObservations.checkId],
			references: [checks.id],
		}),
		delivery: one(gitHubWebhookDeliveries, {
			fields: [checkObservations.deliveryId],
			references: [gitHubWebhookDeliveries.id],
		}),
	})
)
