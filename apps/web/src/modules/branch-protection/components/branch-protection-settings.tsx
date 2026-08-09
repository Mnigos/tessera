import { ORPCError } from '@orpc/client'
import { useBranchProtectionRulesQuery } from '../hooks/use-branch-protection-rules.query'
import { AddBranchProtectionRuleForm } from './add-branch-protection-rule-form'
import { BranchProtectionMessage } from './branch-protection-message'
import { BranchProtectionRulesList } from './branch-protection-rules-list'

interface BranchProtectionSettingsProps {
	username: string
	slug: string
}

export function BranchProtectionSettings({
	username,
	slug,
}: Readonly<BranchProtectionSettingsProps>) {
	const { data, error, isError, isLoading, isSuccess, refetch } =
		useBranchProtectionRulesQuery({
			username,
			slug,
		})
	const isForbidden =
		error instanceof ORPCError && (error.status === 401 || error.status === 403)
	const isEnforced = data?.enforced ?? true

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{username}/{slug}
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					Branch protection
				</h1>
				<p className="text-muted-foreground text-sm">
					Decide what a pull request must satisfy before it can merge into a
					protected branch.
				</p>
			</header>
			{isForbidden ? (
				<BranchProtectionMessage
					description="Only repository admins can manage branch protection."
					title="Admin access required"
				/>
			) : (
				<>
					{isSuccess && !isEnforced && (
						<BranchProtectionMessage
							description="GitHub is the source of truth for this repository, so these rules are stored but enforce nothing. They take effect once Tessera owns the merge."
							title="Rules are inactive"
						/>
					)}
					{isSuccess && (
						<AddBranchProtectionRuleForm slug={slug} username={username} />
					)}
					<BranchProtectionRulesList
						isEnforced={isEnforced}
						isError={isError}
						isLoading={isLoading}
						onReload={() => refetch()}
						rules={data?.rules}
						slug={slug}
						username={username}
					/>
				</>
			)}
		</section>
	)
}
