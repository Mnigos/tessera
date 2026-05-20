import { Card } from '@repo/ui/components/card'
import type { ReactNode } from 'react'

interface GitHubImportMessageProps {
	action?: ReactNode
	description: string
	title: string
}

export function GitHubImportMessage({
	action,
	description,
	title,
}: Readonly<GitHubImportMessageProps>) {
	return (
		<Card className="border-dashed p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-base tracking-normal">{title}</h2>
					<p className="text-muted-foreground text-sm">{description}</p>
				</div>
				{action}
			</div>
		</Card>
	)
}
