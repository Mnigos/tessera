import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	BranchProtectionRule,
	ParsedDeleteBranchProtectionRuleInput,
	ParsedListBranchProtectionRulesInput,
	ParsedSaveBranchProtectionRuleInput,
} from '@repo/contracts'
import type { RepositoryId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	BranchProtectionRuleAlreadyExistsError,
	BranchProtectionRuleNotFoundError,
	BranchProtectionRuleVersionConflictError,
} from '../domain/branch-protection.errors'
import {
	type BranchProtectionRuleView,
	canonicalizeRequiredContexts,
	toBranchProtectionRuleOutput,
} from '../domain/branch-protection-rule'
import { BranchProtectionRepository } from '../infrastructure/branch-protection.repository'

const BRANCH_PROTECTION_UNIQUE_CONSTRAINTS = new Set([
	'branch_protection_rules_repository_target_branch_unique',
])

export interface ListBranchProtectionRulesResult {
	rules: BranchProtectionRule[]
	enforced: boolean
}

interface FindRuleForBranchParams {
	repositoryId: RepositoryId
	targetBranch: string
}

@Injectable()
export class BranchProtectionService {
	constructor(
		private readonly branchProtectionRepository: BranchProtectionRepository,
		private readonly repositoriesService: RepositoriesService
	) {}

	async list(
		viewerUserId: UserId,
		{ slug, username }: ParsedListBranchProtectionRulesInput
	): Promise<ListBranchProtectionRulesResult> {
		const { repositoryId, tesseraWritesAllowed } =
			await this.repositoriesService.getManageableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const rules = await this.branchProtectionRepository.list({ repositoryId })

		return {
			rules: rules.map(toBranchProtectionRuleOutput),
			// Rules stay configurable while GitHub owns the merge, so admins can
			// prepare a policy before cutover; they simply gate nothing until then.
			enforced: tesseraWritesAllowed,
		}
	}

	/**
	 * The rule governing one branch, for the merge path rather than the settings
	 * page: no viewer, no role check, and no output mapping. Callers already hold
	 * the repository context, and the evaluation needs the stored values —
	 * including the version it will record in the audit row.
	 */
	async findRuleForBranch({
		repositoryId,
		targetBranch,
	}: FindRuleForBranchParams): Promise<BranchProtectionRuleView | undefined> {
		return await this.branchProtectionRepository.findByTargetBranch({
			repositoryId,
			targetBranch,
		})
	}

	async save(
		actorUserId: UserId,
		{
			bypass,
			dismissStaleApprovals,
			expectedVersion,
			requireThreadsResolved,
			requiredApprovals,
			requiredCheckContexts,
			slug,
			targetBranch,
			username,
		}: ParsedSaveBranchProtectionRuleInput
	): Promise<BranchProtectionRule> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const values = {
			requiredApprovals,
			requiredCheckContexts: canonicalizeRequiredContexts(
				requiredCheckContexts
			),
			requireThreadsResolved,
			dismissStaleApprovals,
			bypassMinimumRole: bypass.allowed ? bypass.minimumRole : null,
		}

		// A presented version means the caller is editing the rule it already read;
		// its absence is a request to create the branch's first rule.
		if (expectedVersion !== undefined) {
			const result = await this.branchProtectionRepository.update({
				actorUserId,
				expectedVersion,
				repositoryId,
				targetBranch,
				...values,
			})

			if (result.status === 'not_found')
				throw new BranchProtectionRuleNotFoundError({
					repositoryId,
					targetBranch,
				})

			if (result.status === 'version_conflict')
				throw new BranchProtectionRuleVersionConflictError({
					repositoryId,
					targetBranch,
					expectedVersion,
					version: result.version,
				})

			return toBranchProtectionRuleOutput(result.rule)
		}

		try {
			const rule = await this.branchProtectionRepository.create({
				actorUserId,
				repositoryId,
				targetBranch,
				...values,
			})

			return toBranchProtectionRuleOutput(rule)
		} catch (error) {
			if (isUniqueViolation(error, BRANCH_PROTECTION_UNIQUE_CONSTRAINTS))
				throw new BranchProtectionRuleAlreadyExistsError({
					repositoryId,
					targetBranch,
				})

			throw error
		}
	}

	async delete(
		actorUserId: UserId,
		{
			expectedVersion,
			ruleId,
			slug,
			username,
		}: ParsedDeleteBranchProtectionRuleInput
	): Promise<{ deleted: boolean }> {
		const { repositoryId } =
			await this.repositoriesService.getManageableRepositoryContext(
				actorUserId,
				{ username, slug }
			)
		const result = await this.branchProtectionRepository.delete({
			actorUserId,
			expectedVersion,
			repositoryId,
			ruleId,
		})

		if (result.status === 'not_found')
			throw new BranchProtectionRuleNotFoundError({ repositoryId, ruleId })

		if (result.status === 'version_conflict')
			throw new BranchProtectionRuleVersionConflictError({
				repositoryId,
				ruleId,
				expectedVersion,
				version: result.version,
			})

		return { deleted: true }
	}
}
