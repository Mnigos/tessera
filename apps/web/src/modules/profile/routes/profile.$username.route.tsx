import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profile/$username')({
	beforeLoad: ({ params: { username } }) => {
		throw redirect({ to: '/$handle', params: { handle: username } })
	},
})
