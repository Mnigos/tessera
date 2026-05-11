import { Button } from '@repo/ui/components/button'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from '@tanstack/react-router'
import { GitBranch, LogOut } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { FaGithub } from 'react-icons/fa'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import type { RouterContext } from '../router'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async ({ context }) => {
		try {
			const session = await context.queryClient.ensureQueryData(
				context.orpc.auth.session.queryOptions()
			)

			return {
				session,
				user: session.user,
			}
		} catch {
			return {
				session: {},
				user: undefined,
			}
		}
	},
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Tessera' },
			{
				name: 'description',
				content: 'Open source Git collaboration for focused teams.',
			},
			{ name: 'theme-color', content: '#171717' },
		],
		links: [
			{ rel: 'preload', href: appCss, as: 'style' },
			{ rel: 'stylesheet', href: appCss },
		],
	}),
	component: RootComponent,
})

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
			<ReactQueryDevtools buttonPosition="bottom-left" />
		</RootDocument>
	)
}

function RootDocument({ children }: Readonly<PropsWithChildren>) {
	return (
		<html className="dark" lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground">
				<div className="flex min-h-screen flex-col">
					<Navbar />
					<div className="flex-1">{children}</div>
				</div>
				<Scripts />
			</body>
		</html>
	)
}

function Navbar() {
	const { isAuthenticated, isLoading, signIn, signOut, user } = useAuth()

	return (
		<header className="border-border border-b bg-background/95">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
				<Link className="flex items-center gap-2 font-semibold" to="/">
					<GitBranch className="size-5 text-primary" />
					Tessera
				</Link>
				<nav className="flex items-center gap-3">
					{isAuthenticated && (
						<Link
							activeProps={{ className: 'text-foreground' }}
							className="text-muted-foreground text-sm hover:text-foreground"
							to="/profile"
						>
							Profile
						</Link>
					)}
					{isAuthenticated ? (
						<div className="flex items-center gap-3">
							{user && (
								<div className="hidden items-center gap-2 sm:flex">
									{user.avatarUrl ? (
										<img
											alt=""
											className="size-8 rounded-md"
											height="32"
											src={user.avatarUrl}
											width="32"
										/>
									) : (
										<div className="size-8 rounded-md bg-secondary" />
									)}
									<span className="max-w-36 truncate text-muted-foreground text-sm">
										{user.displayName}
									</span>
								</div>
							)}
							<Button onClick={signOut} size="sm" variant="secondary">
								<LogOut className="size-4" />
								Sign out
							</Button>
						</div>
					) : (
						<Button disabled={isLoading} onClick={signIn} size="sm">
							<FaGithub className="size-4" />
							Sign in
						</Button>
					)}
				</nav>
			</div>
		</header>
	)
}
