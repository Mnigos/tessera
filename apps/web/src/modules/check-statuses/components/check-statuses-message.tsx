import { Card } from '@repo/ui/components/card'

interface CheckStatusesMessageProps {
	description: string
	title: string
}

export function CheckStatusesMessage({
	description,
	title,
}: Readonly<CheckStatusesMessageProps>) {
	return (
		<Card className="border-dashed p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">{title}</h2>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
		</Card>
	)
}
