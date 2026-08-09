import { ORPCError } from '@orpc/client'
import type {
	CheckStatusProvider,
	CreatedCheckStatusCredential,
} from '@repo/contracts'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useState } from 'react'
import { useCheckStatusProvidersQuery } from '../hooks/use-check-status-providers.query'
import { AddCheckStatusProviderForm } from './add-check-status-provider-form'
import { CheckStatusCredentialSecret } from './check-status-credential-secret'
import { CheckStatusProviderCard } from './check-status-provider-card'
import { CheckStatusesMessage } from './check-statuses-message'

interface CheckStatusProvidersSettingsProps {
	username: string
	slug: string
}

export function CheckStatusProvidersSettings({
	username,
	slug,
}: Readonly<CheckStatusProvidersSettingsProps>) {
	// The secret exists only in the response that created it, so it lives here
	// until the admin navigates away — never in the list, which is read back from
	// a store that holds a hash.
	const [created, setCreated] = useState<CreatedCheckStatusCredential>()
	const { data, error, isError, isLoading, isSuccess } =
		useCheckStatusProvidersQuery({ username, slug })
	const isForbidden =
		error instanceof ORPCError && (error.status === 401 || error.status === 403)

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{username}/{slug}
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					Status providers
				</h1>
				<p className="text-muted-foreground text-sm">
					Let an external CI system publish commit statuses to this repository,
					and nothing else.
				</p>
			</header>
			{isForbidden ? (
				<CheckStatusesMessage
					description="Only repository admins can manage status providers."
					title="Admin access required"
				/>
			) : (
				<>
					{created && (
						<CheckStatusCredentialSecret
							providerDisplayName={created.provider.displayName}
							token={created.token}
						/>
					)}
					{isSuccess && (
						<AddCheckStatusProviderForm
							onCreated={setCreated}
							slug={slug}
							username={username}
						/>
					)}
					<CheckStatusProvidersList
						isError={isError}
						isLoading={isLoading}
						onCredentialCreated={setCreated}
						providers={data?.providers}
						slug={slug}
						username={username}
					/>
				</>
			)}
		</section>
	)
}

interface CheckStatusProvidersListProps
	extends CheckStatusProvidersSettingsProps {
	isError: boolean
	isLoading: boolean
	onCredentialCreated: (created: CreatedCheckStatusCredential) => void
	providers?: CheckStatusProvider[]
}

function CheckStatusProvidersList({
	isError,
	isLoading,
	onCredentialCreated,
	providers,
	slug,
	username,
}: Readonly<CheckStatusProvidersListProps>) {
	if (isLoading)
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
		)

	if (isError)
		return (
			<CheckStatusesMessage
				description="The status providers for this repository could not be loaded."
				title="Providers unavailable"
			/>
		)

	if (!providers?.length)
		return (
			<CheckStatusesMessage
				description="Nothing outside Tessera publishes statuses here yet."
				title="No status providers"
			/>
		)

	return (
		<div className="flex flex-col gap-3">
			{providers.map(provider => (
				<CheckStatusProviderCard
					key={provider.id}
					onCredentialCreated={onCredentialCreated}
					provider={provider}
					slug={slug}
					username={username}
				/>
			))}
		</div>
	)
}
