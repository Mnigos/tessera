import { Card } from '@repo/ui/components/card'

interface GitHubImportMessageProps {
	description: string
	title: string
}

export function GitHubImportMessage({
	description,
	title,
}: Readonly<GitHubImportMessageProps>) {
	return (
		<Card className="border-dashed p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">{title}</h2>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
		</Card>
	)
}
