import { Button } from '@repo/ui/components/button'
import { Plus } from 'lucide-react'
import {
	createRequiredContextRow,
	type RequiredContextRow,
} from '../helpers/branch-protection-rule-values'
import { RequiredCheckContextRow } from './required-check-context-row'

interface RequiredCheckContextsEditorProps {
	disabled?: boolean
	idPrefix: string
	onRowsChange: (rows: RequiredContextRow[]) => void
	rows: RequiredContextRow[]
}

export function RequiredCheckContextsEditor({
	disabled = false,
	idPrefix,
	onRowsChange,
	rows,
}: Readonly<RequiredCheckContextsEditorProps>) {
	return (
		<fieldset className="flex flex-col gap-3">
			<legend className="font-medium text-sm">Required checks</legend>
			<p className="text-muted-foreground text-sm">
				Every listed check must succeed on the head commit. Leave the kind and
				provider empty to match on the check name alone.
			</p>
			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">No checks required.</p>
			) : (
				<ul className="flex flex-col gap-3">
					{rows.map((row, index) => (
						<RequiredCheckContextRow
							disabled={disabled}
							idPrefix={idPrefix}
							index={index}
							key={row.id}
							onChange={changes =>
								onRowsChange(
									rows.map(candidate =>
										candidate.id === row.id
											? { ...candidate, ...changes }
											: candidate
									)
								)
							}
							onRemove={() =>
								onRowsChange(rows.filter(candidate => candidate.id !== row.id))
							}
							row={row}
						/>
					))}
				</ul>
			)}
			<Button
				className="w-fit"
				disabled={disabled}
				onClick={() => onRowsChange([...rows, createRequiredContextRow()])}
				size="sm"
				type="button"
				variant="secondary"
			>
				<Plus className="size-4" />
				Add required check
			</Button>
		</fieldset>
	)
}
