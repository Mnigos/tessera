import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

interface NewPullRequestLinkProps {
	username: string
	slug: string
}

/** The same call to action from the list header and from the first-run empty state. */
export function NewPullRequestLink({
	username,
	slug,
}: Readonly<NewPullRequestLinkProps>) {
	return (
		<Link
			className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
			params={{ username, slug }}
			to="/$username/$slug/pulls/new"
		>
			<Plus aria-hidden className="size-4" />
			New pull request
		</Link>
	)
}
