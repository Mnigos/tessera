import type { BranchProtectionRule } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { ShieldCheck } from 'lucide-react'
import { BranchProtectionMessage } from './branch-protection-message'
import { BranchProtectionRuleCard } from './branch-protection-rule-card'

const RULE_LOADING_ROWS = ['rule-1', 'rule-2']

interface BranchProtectionRulesListProps {
	isEnforced: boolean
	isError: boolean
	isLoading: boolean
	onReload: () => void
	rules?: BranchProtectionRule[]
	slug: string
	username: string
}

export function BranchProtectionRulesList({
	isEnforced,
	isError,
	isLoading,
	onReload,
	rules,
	slug,
	username,
}: Readonly<BranchProtectionRulesListProps>) {
	if (isLoading) return <BranchProtectionRulesLoadingState />

	if (isError)
		return (
			<BranchProtectionMessage
				description="The protection rules for this repository could not be loaded."
				title="Protection rules could not be loaded"
			/>
		)

	if (!rules)
		return (
			<BranchProtectionMessage
				description="The protection rule list returned no data."
				title="Protection rules are unavailable"
			/>
		)

	if (rules.length === 0)
		return (
			<Card className="flex flex-col items-center gap-2 p-8 text-center">
				<ShieldCheck aria-hidden className="size-6 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">
					No branches are protected yet.
				</p>
				<p className="text-muted-foreground text-sm">
					Add a rule above to require approvals, checks, or resolved
					conversations before merging.
				</p>
			</Card>
		)

	return (
		<div className="flex flex-col gap-4">
			{rules.map(rule => (
				<BranchProtectionRuleCard
					isEnforced={isEnforced}
					key={`${rule.id}:${rule.version}`}
					onReload={onReload}
					rule={rule}
					slug={slug}
					username={username}
				/>
			))}
		</div>
	)
}

function BranchProtectionRulesLoadingState() {
	return (
		<div className="flex flex-col gap-4">
			{RULE_LOADING_ROWS.map(row => (
				<Card className="gap-3" key={row}>
					<div className="h-4 max-w-40 animate-pulse rounded bg-muted" />
					<div className="h-9 animate-pulse rounded bg-muted/70" />
					<div className="h-9 max-w-64 animate-pulse rounded bg-muted/70" />
				</Card>
			))}
		</div>
	)
}
