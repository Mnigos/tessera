import { Card } from '@repo/ui/components/card'

interface RepositoryBrowserMessageProps {
	title: string
	children: React.ReactNode
}

export function RepositoryBrowserMessage({
	title,
	children,
}: Readonly<RepositoryBrowserMessageProps>) {
	return (
		<Card className="border-dashed p-4">
			<h2 className="font-medium text-sm">{title}</h2>
			<p className="mt-1 text-muted-foreground text-sm">{children}</p>
		</Card>
	)
}
