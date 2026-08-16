import type { Organization } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { Avatar } from '@repo/ui/components/avatar'
import { Button } from '@repo/ui/components/button'
import { Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

interface OrganizationHeaderProps {
	organization: Organization
	viewerRole?: OrganizationRole
}

export function OrganizationHeader({
	organization,
	viewerRole,
}: Readonly<OrganizationHeaderProps>) {
	return (
		<section className="flex items-center gap-4">
			<Avatar
				className="size-20 rounded-lg"
				displayName={organization.name}
				size="lg"
			/>
			<div className="min-w-0 flex-1">
				<h1 className="truncate font-semibold text-3xl tracking-normal">
					{organization.name}
				</h1>
				<p className="truncate text-muted-foreground">@{organization.slug}</p>
			</div>
			{viewerRole && (
				<Button
					className="shrink-0"
					nativeButton={false}
					render={
						<Link
							params={{ slug: organization.slug }}
							to="/organizations/$slug/settings"
						/>
					}
					size="sm"
					variant="secondary"
				>
					<Settings className="size-4" />
					Settings
				</Button>
			)}
		</section>
	)
}
