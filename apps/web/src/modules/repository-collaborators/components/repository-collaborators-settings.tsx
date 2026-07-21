import { ORPCError } from '@orpc/client'
import { useRepositoryCollaboratorsQuery } from '../hooks/use-repository-collaborators.query'
import { AddRepositoryCollaboratorForm } from './add-repository-collaborator-form'
import { RepositoryCollaboratorsList } from './repository-collaborators-list'
import { RepositoryCollaboratorsMessage } from './repository-collaborators-message'

interface RepositoryCollaboratorsSettingsProps {
	username: string
	slug: string
}

export function RepositoryCollaboratorsSettings({
	username,
	slug,
}: Readonly<RepositoryCollaboratorsSettingsProps>) {
	const { data, error, isError, isLoading, isSuccess } =
		useRepositoryCollaboratorsQuery({
			username,
			slug,
		})
	const isForbidden =
		error instanceof ORPCError && (error.status === 401 || error.status === 403)

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{username}/{slug}
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					Collaborators
				</h1>
				<p className="text-muted-foreground text-sm">
					Manage who can read, write, and administer this repository.
				</p>
			</header>
			{isForbidden ? (
				<RepositoryCollaboratorsMessage
					description="Only repository admins can manage collaborators."
					title="Admin access required"
				/>
			) : (
				<>
					{isSuccess && (
						<AddRepositoryCollaboratorForm slug={slug} username={username} />
					)}
					<RepositoryCollaboratorsList
						collaborators={data?.collaborators}
						isError={isError}
						isLoading={isLoading}
						slug={slug}
						username={username}
					/>
				</>
			)}
		</section>
	)
}
