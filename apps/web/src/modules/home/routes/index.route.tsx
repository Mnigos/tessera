import { Button } from '@repo/ui/components/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@repo/ui/components/card'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Code2, GitPullRequest, Plug, ShieldCheck } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { useAuth } from '@/modules/auth/hooks/use-auth'

export const Route = createFileRoute('/')({
	component: HomeRoute,
})

function HomeRoute() {
	const { isAuthenticated, isLoading, signIn } = useAuth()

	return (
		<main className="min-h-full bg-background text-foreground">
			<section className="mx-auto grid min-h-full max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.1fr_0.9fr] md:items-center">
				<div className="w-full min-w-0 space-y-8">
					<div className="space-y-4">
						<div className="inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-1.5 text-primary text-sm">
							<ShieldCheck className="size-4" />
							Open source Git collaboration
						</div>
						<div className="space-y-3">
							<h1 className="max-w-2xl font-semibold text-5xl tracking-normal">
								A focused home for code review, repositories, and extensible
								workflows.
							</h1>
							<p className="max-w-xl text-lg text-muted-foreground">
								Tessera starts with trustworthy Git hosting foundations and a
								clean collaboration surface, then grows into CI, issue, and AI
								integrations without owning every adjacent tool.
							</p>
						</div>
					</div>

					<div>
						{isAuthenticated ? (
							<Button render={<Link to="/profile" />} size="lg">
								<Code2 className="size-5" />
								Open profile
							</Button>
						) : (
							<Button disabled={isLoading} onClick={signIn} size="lg">
								<FaGithub className="size-5" />
								Sign in with GitHub
							</Button>
						)}
					</div>
				</div>

				<Card className="gap-5 bg-muted/60 p-5">
					<div className="flex items-center gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
							<GitPullRequest className="size-5" />
						</div>
						<CardHeader className="gap-1 p-0">
							<CardTitle className="font-medium text-base">MVP Core</CardTitle>
							<CardDescription>
								Ready for the first repo workflow
							</CardDescription>
						</CardHeader>
					</div>

					<CardContent className="space-y-3 p-0">
						{[
							['GitHub auth', 'scaffolded'],
							['Organizations', 'planned'],
							['Repository browser', 'planned'],
							['Integrations', 'later'],
						].map(([item, status]) => (
							<div
								className="flex items-center justify-between border border-border px-3 py-2 text-sm"
								key={item}
							>
								<span className="inline-flex items-center gap-2">
									{item === 'Integrations' && <Plug className="size-4" />}
									{item}
								</span>
								<span className="text-muted-foreground">{status}</span>
							</div>
						))}
					</CardContent>
				</Card>
			</section>
		</main>
	)
}
