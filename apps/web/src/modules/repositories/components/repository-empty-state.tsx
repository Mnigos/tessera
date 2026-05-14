'use client'

import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { toast } from '@repo/ui/components/sonner'
import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import { useMountEffect } from '@/shared/hooks/use-mount-effect'
import { getRepositoryCloneUrl } from '../helpers/get-repository-clone-url'

const COPY_FEEDBACK_DURATION_MS = 2000

interface RepositoryEmptyStateProps {
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryEmptyState({
	owner,
	repository,
}: Readonly<RepositoryEmptyStateProps>) {
	const [isCloneUrlCopied, setIsCloneUrlCopied] = useState(false)
	const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined
	)
	const cloneUrl = getRepositoryCloneUrl(repository, owner)

	useMountEffect(() => () => {
		if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current)
	})

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
		} catch (error) {
			setIsCloneUrlCopied(false)
			console.error(error)
			toast.error('Could not copy clone URL')
		}
	}

	return (
		<Card className="gap-5 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Empty repository
				</h2>
				<p className="text-muted-foreground text-sm">
					Clone it locally or push an existing project to publish the first
					commit.
				</p>
			</div>
			{cloneUrl ? (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2 sm:flex-row">
						<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
							{cloneUrl}
						</code>
						<Button
							aria-label={
								isCloneUrlCopied
									? 'Clone URL copied'
									: 'Copy repository clone URL'
							}
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
						<output aria-live="polite" className="sr-only">
							{isCloneUrlCopied ? 'Clone URL copied' : ''}
						</output>
					</div>
					<div className="flex flex-col gap-2">
						<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
							git clone {cloneUrl}
						</code>
						<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
							git remote add origin {cloneUrl}
						</code>
						<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
							git push origin main
						</code>
					</div>
					<p className="text-muted-foreground text-sm">
						When Git prompts for credentials, use your Tessera username and a
						Git access token with git:write as the password.
					</p>
				</div>
			) : (
				<p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
					Clone URL is not configured yet.
				</p>
			)}
		</Card>
	)
}
