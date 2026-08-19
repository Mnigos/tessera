import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/$username/$slug/pulls/$number')({
	component: PullRequestRoute,
})

function PullRequestRoute() {
	return <Outlet />
}
