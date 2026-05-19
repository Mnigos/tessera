import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/import')({
	component: ImportRoute,
})

function ImportRoute() {
	return <Outlet />
}
