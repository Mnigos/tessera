import { createFileRoute, redirect } from '@tanstack/react-router'

/** The tab lived at /files before it was renamed; old links keep working. */
export const Route = createFileRoute('/$username/$slug/pulls/$number/files')({
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: '/$username/$slug/pulls/$number/changes',
			params,
			search,
			replace: true,
		})
	},
})
