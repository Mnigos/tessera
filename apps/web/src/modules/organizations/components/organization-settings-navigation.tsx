import {
	tabsListClassName,
	tabsTriggerClassName,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'

export type OrganizationSettingsTab = 'general' | 'members' | 'invitations'

interface OrganizationSettingsNavigationItem {
	label: string
	tab: OrganizationSettingsTab
	to:
		| '/organizations/$slug/settings'
		| '/organizations/$slug/settings/members'
		| '/organizations/$slug/settings/invitations'
	/** Invitations expose email addresses. */
	requiresManagement?: boolean
}

const ORGANIZATION_SETTINGS_NAVIGATION: OrganizationSettingsNavigationItem[] = [
	{ label: 'General', tab: 'general', to: '/organizations/$slug/settings' },
	{
		label: 'Members',
		tab: 'members',
		to: '/organizations/$slug/settings/members',
	},
	{
		label: 'Invitations',
		tab: 'invitations',
		to: '/organizations/$slug/settings/invitations',
		requiresManagement: true,
	},
]

interface OrganizationSettingsNavigationProps {
	slug: string
	tab: OrganizationSettingsTab
	canManageInvitations: boolean
}

export function OrganizationSettingsNavigation({
	canManageInvitations,
	slug,
	tab,
}: Readonly<OrganizationSettingsNavigationProps>) {
	const items = ORGANIZATION_SETTINGS_NAVIGATION.filter(
		item => !item.requiresManagement || canManageInvitations
	)

	return (
		<nav aria-label="Organization settings">
			<ul className={tabsListClassName}>
				{items.map(item => {
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
