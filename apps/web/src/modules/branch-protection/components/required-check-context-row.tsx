import type { CheckKind } from '@repo/contracts'
import { checkKinds } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { Trash2 } from 'lucide-react'
import type { RequiredContextRow } from '../helpers/branch-protection-rule-values'

const ANY_CHECK_KIND_VALUE = 'any'

type RequiredContextKindValue = typeof ANY_CHECK_KIND_VALUE | CheckKind

const CHECK_KIND_VALUES: RequiredContextKindValue[] = [
	ANY_CHECK_KIND_VALUE,
	...checkKinds,
]

const CHECK_KIND_LABELS: Record<RequiredContextKindValue, string> = {
	any: 'Any kind',
	status: 'Status',
	check_run: 'Check run',
}

const INPUT_CLASS_NAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60'

interface RequiredCheckContextRowProps {
	disabled: boolean
	idPrefix: string
	index: number
	onChange: (changes: Partial<RequiredContextRow>) => void
	onRemove: () => void
	row: RequiredContextRow
}

export function RequiredCheckContextRow({
	disabled,
	idPrefix,
	index,
	onChange,
	onRemove,
	row,
}: Readonly<RequiredCheckContextRowProps>) {
	const kindValue: RequiredContextKindValue = row.kind ?? ANY_CHECK_KIND_VALUE

	function handleKindChange(value: RequiredContextKindValue | null) {
		onChange({
			kind: !value || value === ANY_CHECK_KIND_VALUE ? undefined : value,
		})
	}

	return (
		<li className="flex flex-col gap-2 sm:flex-row sm:items-end">
			<div className="flex flex-1 flex-col gap-2">
				<Label htmlFor={`${idPrefix}-context-${row.id}`}>
					Check {index + 1}
				</Label>
				<input
					className={INPUT_CLASS_NAME}
					disabled={disabled}
					id={`${idPrefix}-context-${row.id}`}
					onChange={event => onChange({ context: event.target.value })}
					placeholder="build"
					value={row.context}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${idPrefix}-kind-${row.id}`}>Kind</Label>
				<Select
					disabled={disabled}
					onValueChange={handleKindChange}
					value={kindValue}
				>
					<SelectTrigger className="min-w-36" id={`${idPrefix}-kind-${row.id}`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="start">
						{CHECK_KIND_VALUES.map(value => (
							<SelectItem key={value} value={value}>
								{CHECK_KIND_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${idPrefix}-provider-${row.id}`}>Provider app</Label>
				<input
					className={INPUT_CLASS_NAME}
					disabled={disabled}
					id={`${idPrefix}-provider-${row.id}`}
					onChange={event => onChange({ providerAppId: event.target.value })}
					placeholder="optional"
					value={row.providerAppId ?? ''}
				/>
			</div>
			<Button
				aria-label={`Remove required check ${index + 1}`}
				disabled={disabled}
				onClick={onRemove}
				size="icon"
				type="button"
				variant="ghost"
			>
				<Trash2 className="size-4 text-muted-foreground" />
			</Button>
		</li>
	)
}
