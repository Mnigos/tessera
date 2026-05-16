import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { GitBranch } from 'lucide-react'
import {
	getRepositoryRefDisplayName,
	type RepositoryRefOption,
} from '../helpers/repository-refs'

interface RepositoryRefSelectorProps {
	refs: RepositoryRefOption[]
	selectedRef: string
	onSelectedRefChange: (refName: string) => void
	disabled?: boolean
}

export function RepositoryRefSelector({
	refs,
	selectedRef,
	onSelectedRefChange,
	disabled = false,
}: Readonly<RepositoryRefSelectorProps>) {
	const branchRefs = refs.filter(ref => ref.kind === 'branch')
	const tagRefs = refs.filter(ref => ref.kind === 'tag')
	const selectedRefName = getRepositoryRefDisplayName(selectedRef)
	const isUnavailable = disabled || refs.length === 0

	function handleValueChange(refName: string | null) {
		if (!refName) return

		onSelectedRefChange(refName)
	}

	return (
		<Select
			disabled={isUnavailable}
			onValueChange={handleValueChange}
			value={selectedRef}
		>
			<SelectTrigger
				aria-label="Repository ref"
				className="w-full max-w-72 justify-start sm:w-56"
			>
				<GitBranch className="size-4 shrink-0 text-muted-foreground" />
				<SelectValue placeholder="No refs">
					{isUnavailable ? 'No refs' : selectedRefName}
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="start" className="w-72">
				{branchRefs.length > 0 && (
					<SelectGroup>
						<SelectLabel>Branches</SelectLabel>
						{branchRefs.map(ref => (
							<SelectItem key={ref.qualifiedName} value={ref.qualifiedName}>
								{ref.name}
							</SelectItem>
						))}
					</SelectGroup>
				)}
				{tagRefs.length > 0 && (
					<SelectGroup>
						<SelectLabel>Tags</SelectLabel>
						{tagRefs.map(ref => (
							<SelectItem key={ref.qualifiedName} value={ref.qualifiedName}>
								{ref.name}
							</SelectItem>
						))}
					</SelectGroup>
				)}
			</SelectContent>
		</Select>
	)
}
