import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profile')({
	loader: async ({ context, location }) => {
		const isProfileRootPath =
			location.pathname === '/profile' || location.pathname === '/profile/'

		if (!isProfileRootPath) return

		const session = await context.queryClient.ensureQueryData(
			context.orpc.auth.session.queryOptions()
		)

		if (!session.user?.username)
			throw redirect({
				to: '/',
			})

		throw redirect({
			to: '/profile/$username',
			params: { username: session.user.username },
		})
	},
	component: ProfileRoute,
})

function ProfileRoute() {
	return <Outlet />
}
