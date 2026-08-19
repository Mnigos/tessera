import type { RepositoryBrowserSummary } from '@repo/contracts'
import {
	tabsListClassName,
	tabsTriggerClassName,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Link, useRouterState } from '@tanstack/react-router'
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

const REPOSITORY_ROUTE_ID = '/$username/$slug'

type RepositorySection =
	| 'branch-protection'
	| 'code'
	| 'collaborators'
	| 'commits'
	| 'github'
	| 'pulls'
	| 'status-providers'

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
	section: RepositorySection
	to:
		| '/$username/$slug'
		| '/$username/$slug/commits/$ref'
		| '/$username/$slug/pulls'
		| '/$username/$slug/settings/branch-protection'
		| '/$username/$slug/settings/collaborators'
		| '/$username/$slug/settings/github'
		| '/$username/$slug/settings/status-providers'
}

/** Tree and blob pages are the Code tab too, so the section is read from the route. */
function getRepositorySection(routeId: string): RepositorySection {
	const path = routeId.slice(REPOSITORY_ROUTE_ID.length)

	if (path.startsWith('/commits')) return 'commits'

	if (path.startsWith('/pulls')) return 'pulls'

	if (path.startsWith('/settings/'))
		return path.slice('/settings/'.length) as RepositorySection

	return 'code'
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
	const routeId = useRouterState({
		select: state => state.matches.at(-1)?.routeId ?? '',
	})
	const activeSection = getRepositorySection(routeId)
	const params = { username: owner.username, slug: repository.slug }
	const items: RepositoryNavigationItem[] = [
		{
			icon: Code,
			label: 'Code',
			search: { ref: selectedRef },
			section: 'code',
			to: '/$username/$slug',
		},
		{
			count: commitCount,
			icon: History,
			label: 'Commits',
			params: { ref: selectedQualifiedRef },
			section: 'commits',
			to: '/$username/$slug/commits/$ref',
		},
		{
			count: openPullRequestCount,
			icon: GitPullRequest,
			label: 'Pull requests',
			section: 'pulls',
			to: '/$username/$slug/pulls',
		},
	]

	if (canAdministerRepository(viewerRole))
		items.push(
			{
				count: collaboratorCount,
				icon: Settings,
				label: 'Collaborators',
				section: 'collaborators',
				to: '/$username/$slug/settings/collaborators',
			},
			{
				icon: ShieldCheck,
				label: 'Branch protection',
				section: 'branch-protection',
				to: '/$username/$slug/settings/branch-protection',
			},
			{
				icon: CircleDot,
				label: 'Status providers',
				section: 'status-providers',
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
			section: 'github',
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
					const isActive = item.section === activeSection

					return (
						<li key={item.label}>
							<Link
								// The shell tab owns which section is current; the router would
								// call every descendant of the overview path current too.
								activeOptions={{ exact: true }}
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
