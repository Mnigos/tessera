import { Label } from '@repo/ui/components/label'
import { cn } from '@repo/ui/utils'
import type { BranchProtectionRuleFormValues } from '../helpers/branch-protection-rule-values'
import { BranchProtectionBypassSelect } from './branch-protection-bypass-select'
import { RequiredCheckContextsEditor } from './required-check-contexts-editor'

const INPUT_CLASS_NAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60'

interface BranchProtectionRuleFieldsProps {
	disabled?: boolean
	idPrefix: string
	isTargetBranchEditable: boolean
	onValuesChange: (values: BranchProtectionRuleFormValues) => void
	values: BranchProtectionRuleFormValues
}

export function BranchProtectionRuleFields({
	disabled = false,
	idPrefix,
	isTargetBranchEditable,
	onValuesChange,
	values,
}: Readonly<BranchProtectionRuleFieldsProps>) {
	function updateValues(changes: Partial<BranchProtectionRuleFormValues>) {
		onValuesChange({ ...values, ...changes })
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 sm:flex-row">
				<div className="flex flex-1 flex-col gap-2">
					<Label htmlFor={`${idPrefix}-target-branch`}>Target branch</Label>
					<input
						className={INPUT_CLASS_NAME}
						disabled={disabled || !isTargetBranchEditable}
						id={`${idPrefix}-target-branch`}
						maxLength={255}
						onChange={event =>
							updateValues({ targetBranch: event.target.value })
						}
						placeholder="main"
						required
						value={values.targetBranch}
					/>
					<p className="text-muted-foreground text-xs">
						{isTargetBranchEditable
							? 'The rule applies to this exact branch name.'
							: 'Delete and recreate the rule to protect a different branch.'}
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${idPrefix}-required-approvals`}>
						Required approvals
					</Label>
					<input
						className={cn(INPUT_CLASS_NAME, 'sm:w-32')}
						disabled={disabled}
						id={`${idPrefix}-required-approvals`}
						max={100}
						min={0}
						onChange={event =>
							updateValues({
								requiredApprovals: toRequiredApprovals(event.target.value),
							})
						}
						type="number"
						value={values.requiredApprovals}
					/>
				</div>
			</div>
			<RequiredCheckContextsEditor
				disabled={disabled}
				idPrefix={idPrefix}
				onRowsChange={requiredCheckContexts =>
					updateValues({ requiredCheckContexts })
				}
				rows={values.requiredCheckContexts}
			/>
			<fieldset className="flex flex-col gap-2">
				<legend className="font-medium text-sm">Review requirements</legend>
				<label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
					<input
						checked={values.requireThreadsResolved}
						className="mt-0.5 accent-primary"
						disabled={disabled}
						onChange={event =>
							updateValues({ requireThreadsResolved: event.target.checked })
						}
						type="checkbox"
					/>
					<span className="flex flex-col gap-0.5">
						Require resolved conversations
						<span className="text-muted-foreground text-xs">
							Every review thread must be resolved before the branch can be
							merged into.
						</span>
					</span>
				</label>
				<label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
					<input
						checked={values.dismissStaleApprovals}
						className="mt-0.5 accent-primary"
						disabled={disabled}
						onChange={event =>
							updateValues({ dismissStaleApprovals: event.target.checked })
						}
						type="checkbox"
					/>
					<span className="flex flex-col gap-0.5">
						Dismiss stale approvals
						<span className="text-muted-foreground text-xs">
							Approvals given before the latest push stop counting. Requested
							changes keep blocking either way.
						</span>
					</span>
				</label>
			</fieldset>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${idPrefix}-bypass`}>Who may bypass</Label>
				<BranchProtectionBypassSelect
					bypass={values.bypass}
					disabled={disabled}
					id={`${idPrefix}-bypass`}
					onBypassChange={bypass => updateValues({ bypass })}
				/>
				<p className="text-muted-foreground text-xs">
					A bypass records the reason it was used in the repository audit log.
				</p>
			</div>
		</div>
	)
}

function toRequiredApprovals(value: string) {
	const parsed = Number.parseInt(value, 10)

	if (Number.isNaN(parsed)) return 0

	return Math.min(Math.max(parsed, 0), 100)
}
