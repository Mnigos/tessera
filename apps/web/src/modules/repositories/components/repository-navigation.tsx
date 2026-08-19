import type { RepositoryBrowserSummary } from '@repo/contracts'
import {
	tabsListClassName,
	tabsTriggerClassName,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import {
	CircleDot,
	Code,
	Github,
	GitPullRequest,
	History,
	type LucideIcon,
	Settings,
	ShieldCheck,
} from 'lucide-react'
import {
	canAdministerRepository,
	isRepositoryOwner,
} from '../helpers/repository-viewer-role'

interface RepositoryNavigationProps {
	summary: RepositoryBrowserSummary
	selectedQualifiedRef: string
	selectedRef?: string
}

interface RepositoryNavigationItem {
	count?: number
	icon: LucideIcon
	label: string
	params?: { ref: string }
	search?: { ref?: string }
	to:
		| '/$username/$slug'
		| '/$username/$slug/commits/$ref'
		| '/$username/$slug/pulls'
		| '/$username/$slug/settings/branch-protection'
		| '/$username/$slug/settings/collaborators'
		| '/$username/$slug/settings/github'
		| '/$username/$slug/settings/status-providers'
}

export function RepositoryNavigation({
	summary: {
		collaboratorCount,
		commitCount,
		openPullRequestCount,
		owner,
		repository,
		viewerRole,
	},
	selectedQualifiedRef,
	selectedRef,
}: Readonly<RepositoryNavigationProps>) {
	const params = { username: owner.username, slug: repository.slug }
	const items: RepositoryNavigationItem[] = [
		{
			icon: Code,
			label: 'Code',
			search: { ref: selectedRef },
			to: '/$username/$slug',
		},
		{
			count: commitCount,
			icon: History,
			label: 'Commits',
			params: { ref: selectedQualifiedRef },
			to: '/$username/$slug/commits/$ref',
		},
		{
			count: openPullRequestCount,
			icon: GitPullRequest,
			label: 'Pull requests',
			to: '/$username/$slug/pulls',
		},
	]

	if (canAdministerRepository(viewerRole))
		items.push(
			{
				count: collaboratorCount,
				icon: Settings,
				label: 'Collaborators',
				to: '/$username/$slug/settings/collaborators',
			},
			{
				icon: ShieldCheck,
				label: 'Branch protection',
				to: '/$username/$slug/settings/branch-protection',
			},
			{
				icon: CircleDot,
				label: 'Status providers',
				to: '/$username/$slug/settings/status-providers',
			}
		)

	if (
		isRepositoryOwner(viewerRole) &&
		repository.externalSource.mode !== 'none'
	)
		items.push({
			icon: Github,
			label: 'GitHub',
			to: '/$username/$slug/settings/github',
		})

	return (
		<nav aria-label="Repository">
			<ul
				className={cn(
					tabsListClassName,
					'max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
				)}
			>
				{items.map(item => {
					const isActive = item.to === '/$username/$slug'

					return (
						<li key={item.label}>
							<Link
								aria-current={isActive ? 'page' : undefined}
								className={cn(
									tabsTriggerClassName,
									isActive && 'border-primary text-primary'
								)}
								params={{ ...params, ...item.params }}
								search={item.search}
								to={item.to}
							>
								<item.icon />
								{item.label}
								{item.count !== undefined && (
									<span className="rounded-full bg-secondary px-1.5 py-0.5 font-medium text-muted-foreground text-xs tabular-nums">
										{item.count}
									</span>
								)}
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
