import type { OrganizationMembership } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Link } from '@tanstack/react-router'
import { Plus, Settings } from 'lucide-react'
import { useOrganizationsQuery } from '../hooks/use-organizations.query'

interface OrganizationsSectionProps {
	enabled: boolean
}

export function OrganizationsSection({
	enabled,
}: Readonly<OrganizationsSectionProps>) {
	const organizationsQuery = useOrganizationsQuery(enabled)

	if (!enabled) return null

	return (
		<section className="mt-10 flex flex-col gap-3">
			<div className="flex items-end justify-between gap-4">
				<div>
					<h2 className="font-semibold text-xl tracking-normal">
						Your organizations
					</h2>
					<p className="text-muted-foreground text-sm">
						Shared owners of repositories, with handles of their own.
					</p>
				</div>
				<Button
					className="shrink-0"
					nativeButton={false}
					render={<Link to="/organizations/new" />}
					size="sm"
					variant="secondary"
				>
					<Plus className="size-4" />
					New organization
				</Button>
			</div>
			<OrganizationsList
				isError={organizationsQuery.isError}
				isLoading={organizationsQuery.isLoading}
				organizations={organizationsQuery.data?.organizations}
			/>
		</section>
	)
}

interface OrganizationsListProps {
	organizations: OrganizationMembership[] | undefined
	isLoading: boolean
	isError: boolean
}

function OrganizationsList({
	organizations,
	isLoading,
	isError,
}: Readonly<OrganizationsListProps>) {
	if (isLoading)
		return <div className="h-16 animate-pulse rounded-md bg-secondary/60" />

	if (isError)
		return (
			<Card className="border-dashed p-5 text-muted-foreground text-sm">
				Organizations could not be loaded.
			</Card>
		)

	if (!organizations?.length)
		return (
			<Card className="border-dashed p-5 text-muted-foreground text-sm">
				No organizations yet. Create one to own repositories together.
			</Card>
		)

	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{organizations.map(organization => (
				<div
					className="flex items-center justify-between gap-4 p-4"
					key={organization.id}
				>
					<div className="flex min-w-0 flex-col gap-1">
						<h3 className="truncate font-medium text-base">
							{organization.name}
						</h3>
						<p className="truncate text-muted-foreground text-sm">
							/{organization.slug} · {organization.role}
						</p>
					</div>
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
						variant="ghost"
					>
						<Settings className="size-4" />
						Settings
					</Button>
				</div>
			))}
		</Card>
	)
}
