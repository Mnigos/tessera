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
			to: '/$handle',
			params: { handle: context.user.username },
		})
	},
	component: ProfileRoute,
})

function ProfileRoute() {
	return <Outlet />
}
