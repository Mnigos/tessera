import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import { getRepositoryCloneUrl } from '../helpers/get-repository-clone-url'

const COPY_FEEDBACK_DURATION_MS = 2000

interface RepositoryShellProps {
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryShell({
	owner,
	repository,
}: Readonly<RepositoryShellProps>) {
	const [isCloneUrlCopied, setIsCloneUrlCopied] = useState(false)
	const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
	const cloneUrl = getRepositoryCloneUrl(repository, owner)

	async function handleCopyCloneUrl() {
		if (!cloneUrl) return

		try {
			await navigator.clipboard.writeText(cloneUrl)
			if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current)

			setIsCloneUrlCopied(true)
			copyFeedbackTimeout.current = setTimeout(
				() => setIsCloneUrlCopied(false),
				COPY_FEEDBACK_DURATION_MS
			)
		} catch {
			setIsCloneUrlCopied(false)
		}
	}

	return (
		<section className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<p className="text-muted-foreground text-sm">{owner.username}</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-3xl tracking-normal">
							{repository.name}
						</h1>
						<p className="truncate text-muted-foreground">
							{owner.username}/{repository.slug}
						</p>
					</div>
					<span className="w-fit rounded-md border border-border px-2.5 py-1 text-muted-foreground text-sm capitalize">
						{repository.visibility}
					</span>
				</div>
			</div>
			<Card className="gap-4 p-5">
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="font-semibold text-lg tracking-normal">Clone</h2>
						<p className="text-muted-foreground text-sm">
							Use HTTPS to clone this repository.
						</p>
					</div>
					{cloneUrl ? (
						<div className="flex flex-col gap-2 sm:flex-row">
							<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
								{cloneUrl}
							</code>
							<Button
								className="sm:w-fit"
								onClick={handleCopyCloneUrl}
								type="button"
								variant="outline"
							>
								{isCloneUrlCopied ? (
									<Check className="size-4" />
								) : (
									<Copy className="size-4" />
								)}
								{isCloneUrlCopied ? 'Copied' : 'Copy'}
							</Button>
						</div>
					) : (
						<p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
							Clone URL is not configured yet.
						</p>
					)}
					{cloneUrl && (
						<div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
							<div className="flex flex-col gap-1">
								<p className="font-medium text-sm">
									Push an existing repository
								</p>
								<p className="text-muted-foreground text-sm">
									When Git prompts for credentials, use your Tessera username
									and a Git access token with git:write as the password.
								</p>
							</div>
							<div className="flex flex-col gap-2">
								<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
									git remote add origin {cloneUrl}
								</code>
								<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
									git push origin main
								</code>
							</div>
						</div>
					)}
				</div>
			</Card>
			<Card className="p-5">
				<dl className="grid gap-4 sm:grid-cols-2">
					<RepositoryDetail label="Owner" value={owner.username} />
					<RepositoryDetail label="Name" value={repository.name} />
					<RepositoryDetail label="Slug" value={repository.slug} />
					<RepositoryDetail label="Visibility" value={repository.visibility} />
					<div className="sm:col-span-2">
						<dt className="text-muted-foreground text-sm">Description</dt>
						<dd className="mt-1 text-sm">
							{repository.description || 'No description'}
						</dd>
					</div>
				</dl>
			</Card>
		</section>
	)
}

interface RepositoryDetailProps {
	label: string
	value: string
}

function RepositoryDetail({ label, value }: Readonly<RepositoryDetailProps>) {
	return (
		<div>
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="mt-1 text-sm">{value}</dd>
		</div>
	)
}
