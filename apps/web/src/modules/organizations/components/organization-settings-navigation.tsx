import {
	tabsListClassName,
	tabsTriggerClassName,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'

export type OrganizationSettingsTab = 'general'

interface OrganizationSettingsNavigationItem {
	label: string
	tab: OrganizationSettingsTab
	to: '/organizations/$slug/settings'
}

const ORGANIZATION_SETTINGS_NAVIGATION: OrganizationSettingsNavigationItem[] = [
	{ label: 'General', tab: 'general', to: '/organizations/$slug/settings' },
]

interface OrganizationSettingsNavigationProps {
	slug: string
	tab: OrganizationSettingsTab
}

export function OrganizationSettingsNavigation({
	slug,
	tab,
}: Readonly<OrganizationSettingsNavigationProps>) {
	return (
		<nav aria-label="Organization settings">
			<ul className={tabsListClassName}>
				{ORGANIZATION_SETTINGS_NAVIGATION.map(item => {
					const isActive = item.tab === tab

					return (
						<li key={item.tab}>
							<Link
								aria-current={isActive ? 'page' : undefined}
								className={cn(
									tabsTriggerClassName,
									isActive && 'border-primary text-primary'
								)}
								params={{ slug }}
								to={item.to}
							>
								{item.label}
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
