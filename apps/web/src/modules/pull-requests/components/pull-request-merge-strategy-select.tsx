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
	MERGE_STRATEGY_ORDER,
} from '../helpers/merge-strategy'

interface PullRequestMergeStrategySelectProps {
	disabled?: boolean
	onStrategyChange: (strategy: MergeStrategy) => void
	strategy: MergeStrategy
	strategyAvailability?: MergeStrategyAvailability[]
	targetBranch: string
}

/**
 * How this pull request will be merged.
 *
 * Every method stays on the list whether or not it can run right now, and the
 * ones that cannot say why. Hiding them would leave a reader wondering where
 * fast-forward went; naming the reason tells them what would have to change for
 * it to come back.
 */
export function PullRequestMergeStrategySelect({
	disabled = false,
	onStrategyChange,
	strategy,
	strategyAvailability,
	targetBranch,
}: Readonly<PullRequestMergeStrategySelectProps>) {
	function handleValueChange(value: string | null) {
		const selected = MERGE_STRATEGY_ORDER.find(candidate => candidate === value)

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
					{MERGE_STRATEGY_ORDER.map(candidate => {
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
