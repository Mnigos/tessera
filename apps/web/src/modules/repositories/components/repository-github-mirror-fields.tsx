const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

interface SourceFieldProps {
	label: string
	value: string
}

/** A labelled fact about the GitHub source, for a `<dl>` to hold. */
export function SourceField({ label, value }: Readonly<SourceFieldProps>) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</dt>
			<dd className="break-all">{value}</dd>
		</div>
	)
}

interface MirrorTimestampProps {
	label: string
	value?: Date | number | string
}

export function MirrorTimestamp({
	label,
	value,
}: Readonly<MirrorTimestampProps>) {
	const date = value ? new Date(value) : undefined
	const isValid = date && !Number.isNaN(date.getTime())

	return (
		<div className="flex flex-col gap-1">
			<dt className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</dt>
			<dd suppressHydrationWarning>
				{isValid ? (
					<time dateTime={date.toISOString()}>
						{DATE_FORMATTER.format(date)}
					</time>
				) : (
					'Never'
				)}
			</dd>
		</div>
	)
}
