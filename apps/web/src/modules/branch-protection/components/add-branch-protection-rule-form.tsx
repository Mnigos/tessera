import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { ShieldPlus } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import {
	type BranchProtectionRuleFormValues,
	createBranchProtectionRuleFormValues,
	toRequiredContexts,
} from '../helpers/branch-protection-rule-values'
import { getBranchProtectionErrorMessage } from '../helpers/get-branch-protection-error-message'
import { useSaveBranchProtectionRuleMutation } from '../hooks/use-save-branch-protection-rule.mutation'
import { BranchProtectionRuleFields } from './branch-protection-rule-fields'

const ADD_RULE_ERROR_ID = 'add-branch-protection-rule-error'

interface AddBranchProtectionRuleFormProps {
	username: string
	slug: string
}

export function AddBranchProtectionRuleForm({
	username,
	slug,
}: Readonly<AddBranchProtectionRuleFormProps>) {
	const [values, setValues] = useState<BranchProtectionRuleFormValues>(
		createBranchProtectionRuleFormValues
	)
	const saveRule = useSaveBranchProtectionRuleMutation()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const targetBranch = values.targetBranch.trim()

		if (!targetBranch) return

		saveRule.mutate(
			{
				username,
				slug,
				targetBranch,
				requiredApprovals: values.requiredApprovals,
				requiredCheckContexts: toRequiredContexts(values.requiredCheckContexts),
				requireThreadsResolved: values.requireThreadsResolved,
				dismissStaleApprovals: values.dismissStaleApprovals,
				bypass: values.bypass,
			},
			{ onSuccess: () => setValues(createBranchProtectionRuleFormValues()) }
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Add protection rule
				</h2>
				<p className="text-muted-foreground text-sm">
					Choose what a pull request must satisfy before it can merge into a
					branch.
				</p>
			</div>
			<form
				aria-describedby={saveRule.isError ? ADD_RULE_ERROR_ID : undefined}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<BranchProtectionRuleFields
					disabled={saveRule.isPending}
					idPrefix="new-branch-protection-rule"
					isTargetBranchEditable
					onValuesChange={setValues}
					values={values}
				/>
				{saveRule.isError && (
					<p
						className="text-destructive text-sm"
						id={ADD_RULE_ERROR_ID}
						role="alert"
					>
						{getBranchProtectionErrorMessage(saveRule.error, {
							fallback: 'Protection rule could not be created.',
							notFound: 'This repository is no longer available.',
						})}
					</p>
				)}
				<Button
					className="w-full sm:w-fit"
					disabled={saveRule.isPending}
					type="submit"
				>
					<ShieldPlus className="size-4" />
					{saveRule.isPending ? 'Creating' : 'Create rule'}
				</Button>
			</form>
		</Card>
	)
}
