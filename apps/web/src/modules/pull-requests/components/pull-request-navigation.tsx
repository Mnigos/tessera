import {
	tabsListClassName,
	tabsTriggerClassName,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'

export type PullRequestDetailTab = 'overview' | 'commits' | 'files'

interface PullRequestNavigationProps {
	username: string
	slug: string
	number: string
	tab: PullRequestDetailTab
	changedFilesCount?: number
}

interface PullRequestNavigationItem {
	label: string
	tab: PullRequestDetailTab
	to:
		| '/$username/$slug/pulls/$number'
		| '/$username/$slug/pulls/$number/commits'
		| '/$username/$slug/pulls/$number/files'
}

const PULL_REQUEST_NAVIGATION: PullRequestNavigationItem[] = [
	{
		label: 'Overview',
		tab: 'overview',
		to: '/$username/$slug/pulls/$number',
	},
	{
		label: 'Commits',
		tab: 'commits',
		to: '/$username/$slug/pulls/$number/commits',
	},
	{
		label: 'Files changed',
		tab: 'files',
		to: '/$username/$slug/pulls/$number/files',
	},
]

export function PullRequestNavigation({
	username,
	slug,
	number,
	tab,
	changedFilesCount,
}: Readonly<PullRequestNavigationProps>) {
	return (
		<nav aria-label="Pull request details">
			<ul className={tabsListClassName}>
				{PULL_REQUEST_NAVIGATION.map(item => {
					const isActive = item.tab === tab

					return (
						<li key={item.tab}>
							<Link
								aria-current={isActive ? 'page' : undefined}
								className={cn(
									tabsTriggerClassName,
									isActive && 'border-primary text-primary'
								)}
								params={{ username, slug, number }}
								to={item.to}
							>
								{item.label}
								{item.tab === 'files' && changedFilesCount !== undefined && (
									<span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
										{changedFilesCount}
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
