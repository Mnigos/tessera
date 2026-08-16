import { createFileRoute, redirect } from '@tanstack/react-router'
import { CreateOrganizationForm } from '../components/create-organization-form'

export const Route = createFileRoute('/organizations/new')({
	beforeLoad: ({ context }) => {
		if (!context.user) throw redirect({ to: '/' })
	},
	head: () => ({
		meta: [
			{ title: 'New organization · detent' },
			{
				name: 'description',
				content: 'Create a detent organization to own repositories together.',
			},
		],
	}),
	component: CreateOrganizationRoute,
})

function CreateOrganizationRoute() {
	return (
		<main className="mx-auto max-w-2xl px-6 py-8">
			<CreateOrganizationForm />
		</main>
	)
}
