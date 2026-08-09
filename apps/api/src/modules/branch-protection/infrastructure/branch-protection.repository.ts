import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { RequiredContext } from '@repo/contracts'
import {
	and,
	asc,
	branchProtectionRules,
	type DrizzleTransaction,
	eq,
	type RepositoryEvent,
	type RepositoryEventPayload,
	repositoryEvents,
} from '@repo/db'
import type {
	BranchProtectionBypassRole,
	BranchProtectionRuleId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { BranchProtectionRuleCreateFailedError } from '../domain/branch-protection.errors'
import {
	type BranchProtectionRuleView,
	toBranchProtectionRuleSnapshot,
} from '../domain/branch-protection-rule'

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface BranchProtectionRuleValues {
	requiredApprovals: number
	requiredCheckContexts: RequiredContext[]
	requireThreadsResolved: boolean
	dismissStaleApprovals: boolean
	bypassMinimumRole: BranchProtectionBypassRole | null
}

interface FindByTargetBranchParams extends RepositoryParams {
	targetBranch: string
}

interface CreateParams extends RepositoryParams, BranchProtectionRuleValues {
	actorUserId: UserId
	targetBranch: string
}

interface UpdateParams extends CreateParams {
	expectedVersion: number
}

interface DeleteParams extends RepositoryParams {
	actorUserId: UserId
	expectedVersion: number
	ruleId: BranchProtectionRuleId
}

/**
 * `version_conflict` carries the stored version so the caller can tell the
 * client what it was actually competing with.
 */
export type UpdateBranchProtectionRuleResult =
	| { status: 'updated'; rule: BranchProtectionRuleView }
	| { status: 'not_found' }
	| { status: 'version_conflict'; version: number }

export type DeleteBranchProtectionRuleResult =
	| { status: 'deleted' }
	| { status: 'not_found' }
	| { status: 'version_conflict'; version: number }

const BRANCH_PROTECTION_RULE_COLUMNS = {
	id: branchProtectionRules.id,
	targetBranch: branchProtectionRules.targetBranch,
	requiredApprovals: branchProtectionRules.requiredApprovals,
	requiredCheckContexts: branchProtectionRules.requiredCheckContexts,
	requireThreadsResolved: branchProtectionRules.requireThreadsResolved,
	dismissStaleApprovals: branchProtectionRules.dismissStaleApprovals,
	bypassMinimumRole: branchProtectionRules.bypassMinimumRole,
	version: branchProtectionRules.version,
	createdAt: branchProtectionRules.createdAt,
	updatedAt: branchProtectionRules.updatedAt,
}

@Injectable()
export class BranchProtectionRepository {
	constructor(private readonly db: Database) {}

	async list({
		repositoryId,
	}: RepositoryParams): Promise<BranchProtectionRuleView[]> {
		return await this.db
			.select(BRANCH_PROTECTION_RULE_COLUMNS)
			.from(branchProtectionRules)
			.where(eq(branchProtectionRules.repositoryId, repositoryId))
			.orderBy(asc(branchProtectionRules.targetBranch))
	}

	async findByTargetBranch({
		repositoryId,
		targetBranch,
	}: FindByTargetBranchParams): Promise<BranchProtectionRuleView | undefined> {
		const [rule] = await this.db
			.select(BRANCH_PROTECTION_RULE_COLUMNS)
			.from(branchProtectionRules)
			.where(
				and(
					eq(branchProtectionRules.repositoryId, repositoryId),
					eq(branchProtectionRules.targetBranch, targetBranch)
				)
			)
			.limit(1)

		return rule
	}

	async create({
		actorUserId,
		repositoryId,
		targetBranch,
		...values
	}: CreateParams): Promise<BranchProtectionRuleView> {
		return await this.db.transaction(async tx => {
			const [rule] = await tx
				.insert(branchProtectionRules)
				.values({
					...values,
					repositoryId,
					targetBranch,
					createdByUserId: actorUserId,
					updatedByUserId: actorUserId,
				})
				.returning(BRANCH_PROTECTION_RULE_COLUMNS)

			if (!rule)
				throw new BranchProtectionRuleCreateFailedError({
					repositoryId,
					targetBranch,
				})

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'branch_protection_created',
				payload: {
					type: 'branch_protection_created',
					ruleId: rule.id,
					targetBranch: rule.targetBranch,
					current: toBranchProtectionRuleSnapshot(rule),
				},
			})

			return rule
		})
	}

	async update({
		actorUserId,
		expectedVersion,
		repositoryId,
		targetBranch,
		...values
	}: UpdateParams): Promise<UpdateBranchProtectionRuleResult> {
		return await this.db.transaction(async tx => {
			// The row lock is what makes the version check a decision rather than a
			// guess: a concurrent save waits here instead of overwriting this one.
			const [existing] = await tx
				.select(BRANCH_PROTECTION_RULE_COLUMNS)
				.from(branchProtectionRules)
				.where(
					and(
						eq(branchProtectionRules.repositoryId, repositoryId),
						eq(branchProtectionRules.targetBranch, targetBranch)
					)
				)
				.for('update')

			if (!existing) return { status: 'not_found' }

			if (existing.version !== expectedVersion)
				return { status: 'version_conflict', version: existing.version }

			const [rule] = await tx
				.update(branchProtectionRules)
				.set({
					...values,
					version: existing.version + 1,
					updatedByUserId: actorUserId,
				})
				.where(eq(branchProtectionRules.id, existing.id))
				.returning(BRANCH_PROTECTION_RULE_COLUMNS)

			if (!rule) return { status: 'not_found' }

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'branch_protection_updated',
				payload: {
					type: 'branch_protection_updated',
					ruleId: rule.id,
					targetBranch: rule.targetBranch,
					previous: toBranchProtectionRuleSnapshot(existing),
					current: toBranchProtectionRuleSnapshot(rule),
				},
			})

			return { status: 'updated', rule }
		})
	}

	async delete({
		actorUserId,
		expectedVersion,
		repositoryId,
		ruleId,
	}: DeleteParams): Promise<DeleteBranchProtectionRuleResult> {
		return await this.db.transaction(async tx => {
			const [existing] = await tx
				.select(BRANCH_PROTECTION_RULE_COLUMNS)
				.from(branchProtectionRules)
				.where(
					and(
						eq(branchProtectionRules.id, ruleId),
						eq(branchProtectionRules.repositoryId, repositoryId)
					)
				)
				.for('update')

			if (!existing) return { status: 'not_found' }

			if (existing.version !== expectedVersion)
				return { status: 'version_conflict', version: existing.version }

			const [deleted] = await tx
				.delete(branchProtectionRules)
				.where(eq(branchProtectionRules.id, existing.id))
				.returning({ id: branchProtectionRules.id })

			if (!deleted) return { status: 'not_found' }

			await this.createEvent(tx, {
				repositoryId,
				actorUserId,
				type: 'branch_protection_deleted',
				payload: {
					type: 'branch_protection_deleted',
					ruleId: existing.id,
					targetBranch: existing.targetBranch,
					previous: toBranchProtectionRuleSnapshot(existing),
				},
			})

			return { status: 'deleted' }
		})
	}

	private async createEvent(
		db: DrizzleTransaction,
		params: {
			repositoryId: RepositoryId
			actorUserId: UserId
			type: RepositoryEvent['type']
			payload: RepositoryEventPayload
		}
	) {
		await db.insert(repositoryEvents).values(params)
	}
}
