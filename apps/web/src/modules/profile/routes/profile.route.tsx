import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@repo/ui/components/card'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { GitBranch } from 'lucide-react'
import { useAuth } from '@/modules/auth/hooks/use-auth'

export const Route = createFileRoute('/profile')({
	component: ProfileRoute,
})

function ProfileRoute() {
	const { isAuthenticated, isLoading, user } = useAuth()

	if (!(isLoading || isAuthenticated)) return <Navigate to="/" />

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			<div className="space-y-6">
				<div>
					<h1 className="font-semibold text-3xl tracking-normal">Profile</h1>
					<p className="text-muted-foreground">
						The first Tessera workspace shell is ready for repository lists.
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<GitBranch className="size-4" />
							Repositories
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="border border-border border-dashed p-6 text-muted-foreground text-sm">
							{user
								? `${user.displayName}'s repositories will appear here.`
								: 'Loading profile...'}
						</div>
					</CardContent>
				</Card>
			</div>
		</main>
	)
}
