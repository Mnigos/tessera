import { Button } from '@repo/ui/components/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Code2 } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { HomeCapabilities } from '@/modules/home/components/home-capabilities'
import { HomeDialFigure } from '@/modules/home/components/home-dial-figure'
import { HomeMigrationTrack } from '@/modules/home/components/home-migration-track'
import { HomeOpenSource } from '@/modules/home/components/home-open-source'

export const Route = createFileRoute('/')({
	component: HomeRoute,
})

function HomeRoute() {
	return (
		<main className="min-h-full bg-background text-foreground">
			<section className="mx-auto grid max-w-6xl items-center gap-6 px-6 pt-8 pb-6 md:grid-cols-[7fr_5fr] md:gap-16 md:pt-24 md:pb-12">
				<div>
					<span className="font-mono text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Open source Git collaboration
					</span>
					<h1 className="mt-5 max-w-xl font-semibold text-5xl leading-[1.05] tracking-tight md:text-6xl">
						Your repositories, held{' '}
						<em className="text-primary not-italic">exactly</em> in position.
					</h1>
					<p className="mt-6 max-w-lg text-lg text-muted-foreground">
						detent is a Git platform built like an instrument: precise
						repository hosting, code browsing you can read for hours, and
						reviews that measure change instead of decorating it. Self-host it,
						or use the managed cloud.
					</p>
					<HeroActions />
				</div>
				<HomeDialFigure />
			</section>
			<div className="mx-auto max-w-6xl px-6 pb-2">
				<a
					className="flex items-center gap-3 font-mono text-muted-foreground text-xs uppercase tracking-[0.12em] transition-colors duration-150 hover:text-foreground"
					href="#migration"
				>
					<span aria-hidden="true">↓</span>
					Migration in three detents
					<span aria-hidden="true" className="h-px flex-1 bg-border/60" />
				</a>
			</div>
			<HomeMigrationTrack />
			<HomeCapabilities />
			<HomeOpenSource />
		</main>
	)
}

function HeroActions() {
	const { isAuthenticated, isLoading, signIn } = useAuth()

	return (
		<div className="mt-9 flex flex-wrap items-center gap-3.5">
			{isAuthenticated ? (
				<>
					<Button
						nativeButton={false}
						render={<Link to="/profile" />}
						size="lg"
					>
						<Code2 className="size-5" />
						Open profile
					</Button>
					<Button
						nativeButton={false}
						render={<Link to="/import/github" />}
						size="lg"
						variant="outline"
					>
						<FaGithub className="size-5" />
						Import from GitHub
					</Button>
				</>
			) : (
				<>
					<Button disabled={isLoading} onClick={() => signIn()} size="lg">
						<FaGithub className="size-5" />
						Sign in with GitHub
					</Button>
					<span className="font-mono text-muted-foreground text-sm">
						docker compose up
					</span>
				</>
			)}
		</div>
	)
}
