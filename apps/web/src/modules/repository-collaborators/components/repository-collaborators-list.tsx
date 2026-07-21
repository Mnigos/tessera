import type { RepositoryCollaborator } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Users } from 'lucide-react'
import { RepositoryCollaboratorRow } from './repository-collaborator-row'
import { RepositoryCollaboratorsMessage } from './repository-collaborators-message'

interface RepositoryCollaboratorsListProps {
	username: string
	slug: string
	collaborators?: RepositoryCollaborator[]
	isError: boolean
	isLoading: boolean
}

export function RepositoryCollaboratorsList({
	username,
	slug,
	collaborators,
	isError,
	isLoading,
}: Readonly<RepositoryCollaboratorsListProps>) {
	if (isLoading) return <RepositoryCollaboratorsLoadingState />

	if (isError)
		return (
			<RepositoryCollaboratorsMessage
				description="The collaborators for this repository could not be loaded."
				title="Collaborators could not be loaded"
			/>
		)

	if (!collaborators)
		return (
			<RepositoryCollaboratorsMessage
				description="The collaborator list returned no data."
				title="Collaborators are unavailable"
			/>
		)

	if (collaborators.length === 0)
		return (
			<Card className="flex flex-col items-center gap-2 p-8 text-center">
				<Users aria-hidden className="size-6 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">No collaborators yet.</p>
				<p className="text-muted-foreground text-sm">
					Add one above to grant access to this repository.
				</p>
			</Card>
		)

	return (
		<Card className="gap-0 p-0">
			<ul className="divide-y divide-border">
				{collaborators.map(collaborator => (
					<RepositoryCollaboratorRow
						collaborator={collaborator}
						key={collaborator.userId}
						slug={slug}
						username={username}
					/>
				))}
			</ul>
		</Card>
	)
}

function RepositoryCollaboratorsLoadingState() {
	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{COLLABORATOR_LOADING_ROWS.map(row => (
				<div
					className="flex items-center justify-between gap-4 px-4 py-4"
					key={row}
				>
					<div className="flex w-full flex-col gap-2">
						<div className="h-4 max-w-40 animate-pulse rounded bg-muted" />
						<div className="h-3 max-w-28 animate-pulse rounded bg-muted/70" />
					</div>
					<div className="h-8 w-28 shrink-0 animate-pulse rounded bg-muted/70" />
				</div>
			))}
		</Card>
	)
}

const COLLABORATOR_LOADING_ROWS = [
	'collaborator-1',
	'collaborator-2',
	'collaborator-3',
]
