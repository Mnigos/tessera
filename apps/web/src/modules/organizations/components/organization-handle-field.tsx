import { HANDLE_MAX_LENGTH } from '@repo/domain'
import { Label } from '@repo/ui/components/label'

const HANDLE_INPUT_CLASSNAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

interface OrganizationHandleFieldProps {
	id: string
	value: string
	onValueChange: (value: string) => void
	description?: string
}

/**
 * The handle input plus the address it produces, shown together because the
 * handle is the organization's URL and the prefix of every clone command its
 * repositories hand out — not a display name that can be changed quietly.
 *
 * Typing is lowercased in place rather than corrected on submit, so what the
 * field shows is what the handle will be.
 */
export function OrganizationHandleField({
	id,
	value,
	onValueChange,
	description,
}: Readonly<OrganizationHandleFieldProps>) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>Handle</Label>
			<input
				autoCapitalize="none"
				autoComplete="off"
				className={HANDLE_INPUT_CLASSNAME}
				id={id}
				maxLength={HANDLE_MAX_LENGTH}
				name="slug"
				onChange={event => onValueChange(event.target.value.toLowerCase())}
				required
				spellCheck={false}
				value={value}
			/>
			<p className="text-muted-foreground text-sm">
				Your organization will live at{' '}
				<span className="font-medium text-foreground">
					/{value || 'handle'}
				</span>
				.{description ? ` ${description}` : ''}
			</p>
		</div>
	)
}
