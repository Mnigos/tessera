import { ORPCError } from '@orpc/client'
import type { BranchProtectionRule } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { GitBranch, RotateCcw } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import {
	type BranchProtectionRuleFormValues,
	toBranchProtectionRuleFormValues,
	toRequiredContexts,
} from '../helpers/branch-protection-rule-values'
import { getBranchProtectionErrorMessage } from '../helpers/get-branch-protection-error-message'
import { useSaveBranchProtectionRuleMutation } from '../hooks/use-save-branch-protection-rule.mutation'
import { BranchProtectionRuleFields } from './branch-protection-rule-fields'
import { DeleteBranchProtectionRuleDialog } from './delete-branch-protection-rule-dialog'

interface BranchProtectionRuleCardProps {
	isEnforced: boolean
	onReload: () => void
	rule: BranchProtectionRule
	slug: string
	username: string
}

export function BranchProtectionRuleCard({
	isEnforced,
	onReload,
	rule,
	slug,
	username,
}: Readonly<BranchProtectionRuleCardProps>) {
	const [values, setValues] = useState<BranchProtectionRuleFormValues>(() =>
		toBranchProtectionRuleFormValues(rule)
	)
	const saveRule = useSaveBranchProtectionRuleMutation()
	const isVersionConflict =
		saveRule.error instanceof ORPCError && saveRule.error.status === 409
	const errorId = `branch-protection-rule-error-${rule.id}`

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()

		saveRule.mutate({
			username,
			slug,
			targetBranch: rule.targetBranch,
			requiredApprovals: values.requiredApprovals,
			requiredCheckContexts: toRequiredContexts(values.requiredCheckContexts),
			requireThreadsResolved: values.requireThreadsResolved,
			dismissStaleApprovals: values.dismissStaleApprovals,
			bypass: values.bypass,
			expectedVersion: rule.version,
		})
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 font-semibold text-base tracking-normal">
					<GitBranch aria-hidden className="size-4 text-muted-foreground" />
					{rule.targetBranch}
				</h3>
				{!isEnforced && (
					<span className="w-fit rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs">
						Inactive while GitHub is the source of truth
					</span>
				)}
			</div>
			<form
				aria-describedby={saveRule.isError ? errorId : undefined}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<BranchProtectionRuleFields
					disabled={saveRule.isPending}
					idPrefix={`branch-protection-rule-${rule.id}`}
					isTargetBranchEditable={false}
					onValuesChange={setValues}
					values={values}
				/>
				{saveRule.isError && (
					<div className="flex flex-col items-start gap-2" id={errorId}>
						<p className="text-destructive text-sm" role="alert">
							{getBranchProtectionErrorMessage(saveRule.error, {
								fallback: 'Protection rule could not be saved.',
								notFound: 'This rule has been deleted.',
							})}
						</p>
						{isVersionConflict && (
							<Button
								onClick={onReload}
								size="sm"
								type="button"
								variant="ghost"
							>
								<RotateCcw className="size-4" />
								Reload rules
							</Button>
						)}
					</div>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<Button disabled={saveRule.isPending} type="submit">
						{saveRule.isPending ? 'Saving' : 'Save rule'}
					</Button>
					<DeleteBranchProtectionRuleDialog
						onReload={onReload}
						rule={rule}
						slug={slug}
						username={username}
					/>
				</div>
			</form>
		</Card>
	)
}
