import type { MergeStrategyAvailability } from '@repo/contracts'
import type { MergeStrategy } from '@repo/domain'
import { Label } from '@repo/ui/components/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import {
	findMergeStrategyAvailability,
	getMergeStrategyDescription,
	getMergeStrategyLabel,
	getMergeStrategyUnavailableMessage,
} from '../helpers/merge-strategy'

interface PullRequestMergeStrategySelectProps {
	disabled?: boolean
	onStrategyChange: (strategy: MergeStrategy) => void
	/** The methods this pull request can be merged by at all. */
	strategies: readonly MergeStrategy[]
	strategy: MergeStrategy
	strategyAvailability?: MergeStrategyAvailability[]
	targetBranch: string
}

/** A method the branches cannot take right now stays listed, saying why. */
export function PullRequestMergeStrategySelect({
	disabled = false,
	onStrategyChange,
	strategies,
	strategy,
	strategyAvailability,
	targetBranch,
}: Readonly<PullRequestMergeStrategySelectProps>) {
	function handleValueChange(value: string | null) {
		const selected = strategies.find(candidate => candidate === value)

		if (selected) onStrategyChange(selected)
	}

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="merge-strategy">Merge method</Label>
			<Select
				disabled={disabled}
				onValueChange={handleValueChange}
				value={strategy}
			>
				<SelectTrigger
					aria-label="Merge method"
					className="w-full max-w-72 justify-start"
					id="merge-strategy"
				>
					<SelectValue>{getMergeStrategyLabel(strategy)}</SelectValue>
				</SelectTrigger>
				<SelectContent align="start" className="w-80">
					{strategies.map(candidate => {
						const availability = findMergeStrategyAvailability(
							strategyAvailability,
							candidate
						)
						const isUnavailable = availability?.available === false

						return (
							<SelectItem
								disabled={isUnavailable}
								key={candidate}
								value={candidate}
							>
								<span className="flex flex-col gap-0.5">
									<span>{getMergeStrategyLabel(candidate)}</span>
									<span className="text-muted-foreground text-xs">
										{isUnavailable && availability.reason
											? getMergeStrategyUnavailableMessage(availability.reason)
											: getMergeStrategyDescription(candidate, targetBranch)}
									</span>
								</span>
							</SelectItem>
						)
					})}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-sm">
				{getMergeStrategyDescription(strategy, targetBranch)}
			</p>
		</div>
	)
}
