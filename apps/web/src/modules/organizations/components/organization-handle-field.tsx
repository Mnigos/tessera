import { HANDLE_MAX_LENGTH } from '@repo/domain'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'

interface OrganizationHandleFieldProps {
	id: string
	value: string
	onValueChange: (value: string) => void
	description?: string
}

export function OrganizationHandleField({
	id,
	value,
	onValueChange,
	description,
}: Readonly<OrganizationHandleFieldProps>) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>Handle</Label>
			<Input
				autoCapitalize="none"
				autoComplete="off"
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
