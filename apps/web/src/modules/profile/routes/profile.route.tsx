import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profile')({
	loader: ({ context, location }) => {
		const isProfileRootPath =
			location.pathname === '/profile' || location.pathname === '/profile/'

		if (!isProfileRootPath) return

		if (!context.user?.username)
			throw redirect({
				to: '/',
			})

		throw redirect({
			to: '/profile/$username',
			params: { username: context.user.username },
		})
	},
	component: ProfileRoute,
})

function ProfileRoute() {
	return <Outlet />
}
