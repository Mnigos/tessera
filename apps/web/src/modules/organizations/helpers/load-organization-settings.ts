import { ORPCError, safe } from '@orpc/client'
import { notFound, redirect } from '@tanstack/react-router'
import type { RouterContext } from '@/router'
import { getOrganizationQueryOptions } from '../hooks/use-organization.query'
import { getOrganizationsQueryOptions } from '../hooks/use-organizations.query'

interface LoadOrganizationSettingsParams {
	context: RouterContext
	slug: string
}

export async function loadOrganizationSettings({
	context,
	slug,
}: LoadOrganizationSettingsParams) {
	if (!context.user) throw redirect({ to: '/' })

	const { organizations } = await context.queryClient.ensureQueryData(
		getOrganizationsQueryOptions()
	)
	const membership = organizations.find(
		organization => organization.slug === slug
	)

	if (!membership) throw notFound()

	await ensureOrNotFound(
		context.queryClient.ensureQueryData(
			getOrganizationQueryOptions({ organizationId: membership.id })
		)
	)

	return {
		name: membership.name,
		organizationId: membership.id,
		viewerRole: membership.role,
	}
}

/** A viewer removed between two reads gets the not-found page, not a crash. */
export async function ensureOrNotFound(prefetch: Promise<unknown>) {
	const [error] = await safe(prefetch)

	if (error instanceof ORPCError && error.status === 404) throw notFound()

	if (error) throw error
}
